/**
 * Port auto-detect preflight.
 *
 * Run via: tsx scripts/preflight.ts <mode>
 *   mode = infra | dev | test-infra
 *
 * Probes the ports each mode's services want, picks free replacements when
 * something else is already listening, rebuilds the URL env vars that embed
 * those ports, and writes the deltas to .env.local. Consumers (docker compose,
 * Prisma, the api/worker/web apps) pick the overrides up via standard env
 * layering (.env.local > .env).
 *
 * Phase 3 adds:
 *   - SHA-256 staleness hash over port-bearing `.env` keys, stamped as the
 *     first line of `.env.local`. Mismatch → discard and full-regenerate.
 *   - Stickiness probe against `docker compose ps`: when the dev stack is up
 *     and the hash matches, reuse the existing `.env.local` as-is.
 *   - `lsof`/`ps`-based conflict-holder lookup for the resolved-port table.
 *   - `CONDUIT_PREFLIGHT=skip` escape hatch.
 *   - Always writes `.env.local` (header-only when no overrides) so the hash
 *     survives across runs.
 *
 * Self-contained: no third-party imports — keeps `npm install` and CI lean.
 */

import * as net from 'node:net'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
import * as crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

// ---------- Service registry ----------

type ProtocolKind = 'postgres' | 'redis' | 'http' | 'host-port'

type UrlBinding = {
  envVar: string
  protocol: ProtocolKind
}

type ServiceEntry = {
  name: string
  defaultPort: number
  containerPort?: number
  portEnvVar: string
  urls: UrlBinding[]
}

type Mode = 'infra' | 'dev' | 'test-infra'

const POSTGRES: ServiceEntry = {
  name: 'postgres',
  defaultPort: 5432,
  containerPort: 5432,
  portEnvVar: 'POSTGRES_PORT',
  urls: [{ envVar: 'DATABASE_URL', protocol: 'postgres' }],
}

const TEMPORAL: ServiceEntry = {
  name: 'temporal',
  defaultPort: 7233,
  containerPort: 7233,
  portEnvVar: 'TEMPORAL_PORT',
  urls: [{ envVar: 'TEMPORAL_ADDRESS', protocol: 'host-port' }],
}

const TEMPORAL_UI: ServiceEntry = {
  name: 'temporal-ui',
  defaultPort: 8080,
  containerPort: 8080,
  portEnvVar: 'TEMPORAL_UI_PORT',
  urls: [],
}

const REDIS: ServiceEntry = {
  name: 'redis',
  defaultPort: 6379,
  containerPort: 6379,
  portEnvVar: 'REDIS_PORT',
  urls: [{ envVar: 'REDIS_URL', protocol: 'redis' }],
}

const API: ServiceEntry = {
  name: 'api',
  defaultPort: 3000,
  portEnvVar: 'API_PORT',
  urls: [
    { envVar: 'BETTER_AUTH_URL', protocol: 'http' },
    { envVar: 'VITE_API_URL', protocol: 'http' },
  ],
}

const WEB: ServiceEntry = {
  name: 'web',
  defaultPort: 5173,
  portEnvVar: 'WEB_PORT',
  urls: [{ envVar: 'CONDUIT_CORS_ORIGIN', protocol: 'http' }],
}

const TEST_POSTGRES: ServiceEntry = {
  name: 'postgres',
  defaultPort: 55432,
  containerPort: 5432,
  portEnvVar: 'POSTGRES_TEST_PORT',
  urls: [],
}

const TEST_TEMPORAL: ServiceEntry = {
  name: 'temporal',
  defaultPort: 57233,
  containerPort: 7233,
  portEnvVar: 'TEMPORAL_TEST_PORT',
  urls: [],
}

const TEST_REDIS: ServiceEntry = {
  name: 'redis',
  defaultPort: 56379,
  containerPort: 6379,
  portEnvVar: 'REDIS_TEST_PORT',
  urls: [],
}

const REGISTRY: Record<Mode, ServiceEntry[]> = {
  infra: [POSTGRES, TEMPORAL, TEMPORAL_UI, REDIS],
  dev: [POSTGRES, TEMPORAL, TEMPORAL_UI, REDIS, API, WEB],
  'test-infra': [TEST_POSTGRES, TEST_TEMPORAL, TEST_REDIS],
}

/**
 * Container names per mode for the docker-compose-ps stickiness probe. Order
 * doesn't matter — we only ask "is any of these running". Names match what
 * docker-compose.yml / docker-compose.test.yml declare via `container_name`.
 */
const STICKINESS_CONTAINERS: Record<Mode, string[]> = {
  dev: [
    'conduit-postgres',
    'conduit-temporal',
    'conduit-temporal-postgres',
    'conduit-temporal-ui',
    'conduit-redis',
  ],
  infra: [
    'conduit-postgres',
    'conduit-temporal',
    'conduit-temporal-postgres',
    'conduit-temporal-ui',
    'conduit-redis',
  ],
  'test-infra': [
    'conduit-test-postgres',
    'conduit-test-temporal',
    'conduit-test-temporal-postgres',
    'conduit-test-redis',
  ],
}

/**
 * Port-bearing keys whose values feed the staleness hash. Order is fixed
 * (lexicographic) so the hash is reproducible across runs and machines.
 * Missing keys contribute `<KEY>=\n` so adding/removing a value flips the hash
 * without crashing on absence.
 */
const HASH_KEYS: string[] = [
  'API_PORT',
  'BETTER_AUTH_URL',
  'CONDUIT_CORS_ORIGIN',
  'DATABASE_URL',
  'REDIS_URL',
  'TEMPORAL_ADDRESS',
  'VITE_API_URL',
]

const HASH_HEADER_PREFIX = '# CONDUIT_PREFLIGHT_HASH='

// ---------- Paths ----------

const REPO_ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(REPO_ROOT, '.env')
const ENV_LOCAL_FILE = path.join(REPO_ROOT, '.env.local')
const COMPOSE_TEST_FILE = 'docker-compose.test.yml'

// ---------- .env loader ----------

/**
 * Minimal .env parser. Strips line/inline comments, supports KEY=value and
 * KEY="value" (single- and double-quoted), skips blanks. We avoid dotenv-cli
 * here so this script stays standalone (it runs before npm install in some
 * paths).
 */
function loadEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {}
  const raw = fs.readFileSync(file, 'utf8')
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

// ---------- Staleness hash ----------

/**
 * SHA-256 over `<KEY>=<value>\n` lines for HASH_KEYS in lexicographic order,
 * using values from `.env` (never `.env.local`). Missing keys contribute an
 * empty value so the hash flips on add/remove just like on edit.
 */
function computeEnvHash(env: Record<string, string>): string {
  const hasher = crypto.createHash('sha256')
  for (const key of HASH_KEYS) {
    const value = env[key] ?? ''
    hasher.update(`${key}=${value}\n`)
  }
  return hasher.digest('hex')
}

/**
 * Read the first line of `.env.local`, parse the hash off the comment header.
 * Returns null on any failure — caller treats null as "regenerate".
 */
function readExistingHash(): string | null {
  if (!fs.existsSync(ENV_LOCAL_FILE)) return null
  try {
    const raw = fs.readFileSync(ENV_LOCAL_FILE, 'utf8')
    const firstLine = raw.split(/\r?\n/, 1)[0] ?? ''
    if (!firstLine.startsWith(HASH_HEADER_PREFIX)) return null
    return firstLine.slice(HASH_HEADER_PREFIX.length).trim() || null
  } catch {
    return null
  }
}

// ---------- Docker-compose-ps stickiness probe ----------

type ComposePsEntry = { Name?: string; State?: string }

/**
 * Returns the names of conduit containers (from the mode's expected set) that
 * docker reports as `running`. Any failure — docker not installed, daemon
 * down, parse error — yields `[]`, which the caller interprets as "stack not
 * active, can't be sticky".
 */
function getRunningConduitContainers(mode: Mode): string[] {
  const expected = new Set(STICKINESS_CONTAINERS[mode])
  const args = ['compose']
  if (mode === 'test-infra') args.push('-f', COMPOSE_TEST_FILE)
  args.push('ps', '--format', 'json')
  let stdout: string
  try {
    stdout = execFileSync('docker', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }
  const entries: ComposePsEntry[] = []
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      entries.push(...(parsed as ComposePsEntry[]))
    } else if (parsed && typeof parsed === 'object') {
      entries.push(parsed as ComposePsEntry)
    }
  } catch {
    // NDJSON: one JSON object per line.
    for (const line of trimmed.split(/\r?\n/)) {
      const l = line.trim()
      if (!l) continue
      try {
        entries.push(JSON.parse(l) as ComposePsEntry)
      } catch {
        // ignore malformed line
      }
    }
  }
  const running: string[] = []
  for (const e of entries) {
    if (!e || typeof e.Name !== 'string') continue
    if (e.State !== 'running') continue
    if (expected.has(e.Name)) running.push(e.Name)
  }
  return running
}

// ---------- Port probing ----------

/**
 * True when nothing is listening on 127.0.0.1:<port>. We only check the
 * loopback interface because that's what docker's published-port mappings
 * collide against; binding 0.0.0.0 would false-positive on hosts with
 * multiple addresses.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    let settled = false
    const done = (result: boolean) => {
      if (settled) return
      settled = true
      try {
        server.close()
      } catch {
        // ignore — server may not have bound
      }
      resolve(result)
    }
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        done(false)
        return
      }
      // Any other error: treat as taken so we pick a different port rather
      // than crashing preflight on an obscure bind failure.
      done(false)
    })
    server.once('listening', () => {
      done(true)
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Ask the OS for an unused ephemeral port by binding to 0. We immediately
 * close the listener — there's an inherent TOCTOU window before docker binds
 * to it, but it's tiny in practice and matches Supabase's approach.
 */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('failed to read ephemeral port from server.address()'))
        return
      }
      const port = addr.port
      server.close(() => resolve(port))
    })
  })
}

// ---------- Conflict-holder lookup ----------

/**
 * Best-effort: ask `lsof` who's listening on <port>, then `ps` for that PID's
 * comm name. Returns `"PID <pid> '<name>'"` on success, null on any failure
 * (tool missing, no holder, non-zero exit). Cheap enough to call inline on the
 * auto-pick branch where we already know the port is taken.
 */
function findHolder(port: number): string | null {
  let pid: string
  try {
    const out = execFileSync(
      'lsof',
      ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    pid = out.trim().split(/\r?\n/)[0]?.trim() ?? ''
    if (!pid) return null
  } catch {
    return null
  }
  let name: string
  try {
    const out = execFileSync('ps', ['-p', pid, '-o', 'comm='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    name = out.trim()
    if (!name) return null
  } catch {
    return null
  }
  // `ps comm=` may return an absolute path on Linux; show just the basename
  // so the table stays compact and matches the spec's example format.
  const base = name.split('/').pop() ?? name
  return `PID ${pid} '${base}'`
}

// ---------- URL rebuild ----------

/**
 * Swap the port on a URL/host:port string, preserving everything else
 * (credentials, path, query). For schemed URLs we use the URL parser; for
 * the bare `host:port` form (TEMPORAL_ADDRESS) we split on the last colon
 * so IPv6 wouldn't be silently mangled if it ever appears.
 */
function rebuildUrl(original: string, newPort: number, protocol: ProtocolKind): string {
  if (!original) return original
  if (protocol === 'host-port') {
    const lastColon = original.lastIndexOf(':')
    if (lastColon === -1) return `${original}:${newPort}`
    return `${original.slice(0, lastColon)}:${newPort}`
  }
  const u = new URL(original)
  u.port = String(newPort)
  return u.toString()
}

// ---------- Resolve loop ----------

type ResolveSource = 'default' | 'env' | 'resolved' | 'reused'

type ResolvedEntry = {
  service: ServiceEntry
  port: number
  source: ResolveSource
  from?: number
  to?: number
  holder?: string | null
  rebuiltUrls: { envVar: string; value: string }[]
}

async function resolveServices(
  mode: Mode,
  env: Record<string, string>,
): Promise<ResolvedEntry[]> {
  const results: ResolvedEntry[] = []
  for (const service of REGISTRY[mode]) {
    const fromEnv = env[service.portEnvVar]
    const parsed = fromEnv ? Number(fromEnv) : NaN
    const fromEnvOk = Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    const desired = fromEnvOk ? parsed : service.defaultPort
    const sourceIfFree: 'default' | 'env' = fromEnvOk ? 'env' : 'default'

    const free = await isPortFree(desired)
    if (free) {
      results.push({ service, port: desired, source: sourceIfFree, rebuiltUrls: [] })
      continue
    }

    const picked = await pickFreePort()
    const rebuiltUrls: { envVar: string; value: string }[] = []
    for (const binding of service.urls) {
      const original = env[binding.envVar]
      if (!original) continue
      rebuiltUrls.push({
        envVar: binding.envVar,
        value: rebuildUrl(original, picked, binding.protocol),
      })
    }
    results.push({
      service,
      port: picked,
      source: 'resolved',
      from: desired,
      to: picked,
      holder: findHolder(desired),
      rebuiltUrls,
    })
  }
  return results
}

/**
 * Reuse path: derive ResolvedEntry[] from an already-written `.env.local` so
 * the table reflects what's on disk. Every entry is marked `reused`. We
 * deliberately do NOT re-probe — stickiness means "trust the file while the
 * stack is alive", even if the original conflict cleared.
 */
function reuseFromEnvLocal(
  mode: Mode,
  envBase: Record<string, string>,
  envLocal: Record<string, string>,
): ResolvedEntry[] {
  const results: ResolvedEntry[] = []
  for (const service of REGISTRY[mode]) {
    const overridePort = envLocal[service.portEnvVar]
    const parsed = overridePort ? Number(overridePort) : NaN
    const hasOverride = Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    let port: number
    const rebuiltUrls: { envVar: string; value: string }[] = []
    if (hasOverride) {
      port = parsed
      for (const binding of service.urls) {
        const overrideValue = envLocal[binding.envVar]
        if (overrideValue) rebuiltUrls.push({ envVar: binding.envVar, value: overrideValue })
      }
    } else {
      const fromBase = envBase[service.portEnvVar]
      const parsedBase = fromBase ? Number(fromBase) : NaN
      const baseOk = Number.isInteger(parsedBase) && parsedBase > 0 && parsedBase < 65536
      port = baseOk ? parsedBase : service.defaultPort
    }
    results.push({ service, port, source: 'reused', rebuiltUrls })
  }
  return results
}

// ---------- .env.local writer ----------

/**
 * Always double-quote values; escape embedded double quotes. Conservative —
 * we'd rather over-quote a numeric port than risk a value with whitespace
 * round-tripping wrong through docker-compose's env_file parser.
 */
function quoteValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

/**
 * Phase 3 policy: always emit a file (header-only when no overrides). The
 * hash header is the first line so a subsequent run can read it back via
 * `readExistingHash()` and decide whether to keep or discard the file.
 */
function buildEnvLocal(mode: Mode, hash: string, resolved: ResolvedEntry[]): string {
  const header = [
    `${HASH_HEADER_PREFIX}${hash}`,
    '# Auto-generated by scripts/preflight.ts — do not edit.',
    '# Treat like node_modules/.cache: rm if confused, regenerate with `npm run infra:up`.',
    `# mode=${mode}  generated=${new Date().toISOString()}`,
    '',
  ].join('\n')
  const overrideLines: string[] = []
  for (const r of resolved) {
    if (r.source !== 'resolved') continue
    overrideLines.push(`${r.service.portEnvVar}=${quoteValue(String(r.port))}`)
    for (const u of r.rebuiltUrls) {
      overrideLines.push(`${u.envVar}=${quoteValue(u.value)}`)
    }
  }
  if (overrideLines.length === 0) return header
  return header + overrideLines.join('\n') + '\n'
}

function writeEnvLocal(content: string): void {
  fs.writeFileSync(ENV_LOCAL_FILE, content, { mode: 0o600 })
}

// ---------- Resolved-port table ----------

function formatSource(r: ResolvedEntry): string {
  if (r.source === 'reused') return 'reused'
  if (r.source === 'env') return 'env'
  if (r.source === 'default') return 'default'
  // resolved
  const tail = r.holder ? `, conflict with ${r.holder}` : ''
  return `resolved (${r.from} → ${r.to}${tail})`
}

function renderTable(resolved: ResolvedEntry[]): string {
  const headers = ['service', 'port', 'source']
  const rows = resolved.map((r) => [r.service.name, String(r.port), formatSource(r)])
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  )
  const pad = (cell: string, w: number) => cell + ' '.repeat(w - cell.length)
  const sep = (l: string, m: string, r: string) =>
    l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r
  const fmtRow = (cells: string[]) =>
    '│ ' + cells.map((c, i) => pad(c, widths[i])).join(' │ ') + ' │'
  return [
    sep('┌', '┬', '┐'),
    fmtRow(headers),
    sep('├', '┼', '┤'),
    ...rows.map(fmtRow),
    sep('└', '┴', '┘'),
  ].join('\n')
}

// ---------- CLI ----------

function parseMode(arg: string | undefined): Mode {
  if (arg === 'infra' || arg === 'dev' || arg === 'test-infra') return arg
  process.stderr.write(
    `preflight: missing or unknown mode (got ${JSON.stringify(arg)}). Expected: infra | dev | test-infra\n`,
  )
  process.exit(2)
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv[2])

  if (process.env.CONDUIT_PREFLIGHT === 'skip') {
    process.stderr.write('preflight: CONDUIT_PREFLIGHT=skip — bypassing port resolution\n')
    process.exit(0)
  }

  const env = loadEnvFile(ENV_FILE)
  const freshHash = computeEnvHash(env)
  const existingHash = readExistingHash()
  const hashMatches = existingHash !== null && existingHash === freshHash

  // Stickiness: hash matches AND at least one mode container is running.
  // Either condition false → full regeneration.
  let resolved: ResolvedEntry[]
  let reused = false
  if (hashMatches) {
    const running = getRunningConduitContainers(mode)
    if (running.length > 0) {
      const envLocal = loadEnvFile(ENV_LOCAL_FILE)
      resolved = reuseFromEnvLocal(mode, env, envLocal)
      reused = true
    } else {
      resolved = await resolveServices(mode, env)
    }
  } else {
    resolved = await resolveServices(mode, env)
  }

  process.stdout.write(`preflight: mode=${mode}\n`)
  process.stdout.write(renderTable(resolved) + '\n')

  if (reused) {
    process.stdout.write(
      `preflight: reused ${path.relative(REPO_ROOT, ENV_LOCAL_FILE)} (hash match, stack active)\n`,
    )
    return
  }

  const content = buildEnvLocal(mode, freshHash, resolved)
  writeEnvLocal(content)
  const hasOverrides = resolved.some((r) => r.source === 'resolved')
  if (hasOverrides) {
    process.stdout.write(`preflight: wrote ${path.relative(REPO_ROOT, ENV_LOCAL_FILE)}\n`)
  } else {
    process.stdout.write(
      `preflight: wrote ${path.relative(REPO_ROOT, ENV_LOCAL_FILE)} (header only, no overrides needed)\n`,
    )
  }
}

main().catch((err) => {
  process.stderr.write(`preflight: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
