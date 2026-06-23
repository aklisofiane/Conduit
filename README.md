# Conduit

Workflow automation platform for dev teams where agents are the primary unit of work and the board is the orchestrator.

Conduit connects to your project board (GitHub Projects, GitLab boards, Jira) and triggers agentic workflows when issues move between columns. Each workflow runs one or more AI agents (Claude, Codex) that can read code, make changes, call external tools via MCP servers, and move issues to the next stage. Your team stays in control at the board level — review agent output, approve results, and decide what happens next.

## The autonomous review loop

The flagship workflow: Conduit reviews your codebase on a schedule, files an issue for each thing it finds, and — for the fixes you greenlight — implements them and opens a PR. No prompting, no babysitting. You just decide what's worth fixing.

```
   ┌─ cron, nightly ───────────────────┐
   │  review main across four domains  │
   │  Security · Quality · Refactor    │
   │           · Performance           │
   └────────────────┬──────────────────┘
                     ▼
       one GitHub issue per finding
       (board Status set by confidence:
        high → AIDev, low → Review)
                     ▼
          you triage on the board ◀── the only human step
                     ▼
   ┌─ issue moves to "Dev" ────────────┐
   │  plan → dev + tests → docs → QA   │
   │  opens a draft PR, moves to Review│
   └────────────────┬──────────────────┘
                     ▼
              you review the PR
```

Two workflows ship as templates and wire this up end to end:

- **`nightly-review`** — a cron trigger fans out to parallel domain reviewers, then a publisher node files one issue per finding and sets each issue's board Status from the reviewer's confidence.
- **`develop`** — triggers when an issue lands in the `Dev` column, then runs a plan → parallel dev/tests → docs → QA pipeline that opens a draft PR and moves the ticket to `Review`.

These are starting points, not rails — fork them or [build your own](#build-your-own) flow from scratch.

**Why this is the loop that works.** Conduit shines when the spec is already clear — and review findings arrive pre-specified. "This query is N+1, here's the fix" is unambiguous; an agent can act on it without asking a single question. Open-ended feature tickets are the opposite: the agent needs to clarify, which means round-tripping through board comments, re-running, and clarifying again — and a coding agent in your editor closes that loop far faster. The rule of thumb: hand Conduit work that's already well-defined, and let review be the engine that generates it. Keep the exploratory thinking where the feedback is instant.

## How it works

1. A trigger fires — a cron tick on a schedule, or an issue moving to a column on your board (e.g., "To Fix")
2. Agents execute — reading the issue (or scanning the repo, for cron), analyzing code, making changes, posting comments, opening PRs
3. The workflow writes back to the board — opening **new** issues for what it found (cron review), or moving the triggering issue to its next column (e.g., "Review")
4. The team reviews on the board — triaging the new issues, or checking the agent's work — and decides where each issue goes next
5. Moving an issue to the next column can trigger the next workflow, so review-filed issues flow straight into implementation

This is what makes the [autonomous review loop](#the-autonomous-review-loop) above possible: a cron workflow *creates* the issues, and a board move hands them to a second workflow that *implements* them — no human typing a ticket in between.

## Key concepts

- **Board-driven orchestration** — your project board defines the state machine, Conduit runs the workflows
- **Two node types** — triggers and agents. That's it.
- **MCP servers as tools** — agents call GitHub, Slack, databases, and any MCP-compatible server
- **Skills** — reusable instruction bundles from Claude Code and Codex, attachable to agents
- **Workspace-native** — every agent operates on a git workspace with full file and shell access
- **Multi-agent pipelines** — fan-out, parallel execution, workspace inheritance, sequential merge-back
- **Run observability** — live timeline of agent events (text, tools, tokens) on the run detail page
- **Temporal for durability** — crash recovery, retries, cancellation out of the box

## Build your own

Conduit is two node types — triggers and agents — composed however you like. Everything else is configuration.

```
  triggers  →  cron · issue-moved · PR-opened
  agents    →  your prompt + provider (Claude/Codex) + MCP servers + skills
  pipeline  →  chain them, fan out in parallel, merge back
```

A few flows teams build beyond nightly review:

- **Auto-triage** — new issue → label + estimate + route to the right column
- **PR guardian** — PR opened → review + check conventions → request changes or approve
- **Doc sync** — code merged → regenerate affected docs → open a PR

Open the canvas, drop a trigger, wire agents downstream, save. That's a workflow.

## Development

Prerequisites: Node.js 22 (`nvm use`), npm 10+, Docker.

```bash
nvm use
npm install
cp .env.example .env            # then edit it — fill in the values flagged inline (at minimum BETTER_AUTH_SECRET and your agent provider key)
npm run infra:up                # Postgres (5432), Temporal (7233 / UI 8080), Redis (6379) — preflight auto-allocates free ports if any default is taken
npm run db:push                 # apply Prisma schema
npm run build                   # builds TS dist + the agent-runner Docker image
```

Sign-in works with email and password out of the box. To enable OAuth sign-in providers (GitHub today, others later), see [docs/setup-oauth.md](docs/setup-oauth.md).

### Board credentials

Agents reach your board through a platform credential (a token, encrypted at rest with AES-256-GCM). There are two ways to provide one:

- **GitHub OAuth** — if you've enabled GitHub OAuth sign-in (above), signing in with GitHub automatically mirrors your access token into a credential. Nothing else to do.
- **Personal access token** — otherwise, create a token on your platform (for GitHub: **Settings → Developer settings → Personal access tokens**, with `repo` and `project` scopes), then add it in Conduit under **Settings → Integrations** (`/settings/integrations`). The same flow works for GitLab, Jira, Slack, and Discord, including self-hosted instances.

`apps/agent-runner` is the per-run container the worker spawns for every agent execution. Its `build` script chains `tsc` and `docker build -t agent-runner:dev`, so any workspace build keeps the image current. CI tags via `CONDUIT_RUNNER_IMAGE`. Force a clean image rebuild with `npm run docker:agent-runner:build`.

If you authenticate via OAuth instead of API keys:

- **Claude:** run `claude setup-token`, paste the result into `CLAUDE_CODE_OAUTH_TOKEN` in `.env`. The worker forwards it to the runner via the protocol; no bind mount needed.
- **Codex:** set `CONDUIT_AGENT_AUTH=oauth-mount` in `.env`. The worker then bind-mounts only `~/.codex/auth.json` into each runner container at the same absolute path (Codex has no equivalent setup-token flow). **Local-dev only** — it weakens the runner's trust boundary by exposing your `~/.codex/auth.json` to the agent process; leave the default (`api-key`) in any shared environment.

Common scripts (all run through Turborepo where applicable):

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `typecheck` / `lint` / `test` | Pipeline across all workspaces |
| `npm run format` / `format:check` | Prettier |
| `npm run db:push` / `db:generate` / `db:studio` | Prisma (dev uses `db push`; migrations once schema stabilizes) |
| `npm run infra:up` / `infra:down` / `infra:logs` | Manage Docker infra |

Workspaces: `packages/*` (libraries) and `apps/*` (services). A single root `.env` is read by every app — `dotenv-cli` forwards it into the Prisma CLI.

### Running the stack

After `infra:up` and `db:push`, a single command boots all three apps (API on :3000, Temporal worker, and the Vite dev server on :5173):

```bash
npm run dev
```

Open http://localhost:5173, create a workflow, drop an agent, save, and click **Test run**. The run detail page streams `ExecutionLog` events over Socket.IO as the agent executes.

## Documentation

See [docs/INDEX.md](docs/INDEX.md) for the full spec.

## License

[MIT](LICENSE)
