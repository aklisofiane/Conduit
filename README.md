# Conduit

Workflow automation platform for dev teams where agents are the primary unit of work and the board is the orchestrator.

Conduit connects to your project board (GitHub Projects, GitLab boards, Jira) and triggers agentic workflows when issues move between columns. Each workflow runs one or more AI agents (Claude, Codex) that can read code, make changes, call external tools via MCP servers, and move issues to the next stage. Your team stays in control at the board level — review agent output, approve results, and decide what happens next.

## How it works

1. An issue moves to a column on your board (e.g., "To Fix")
2. Conduit detects the change (via webhook or polling) and triggers the associated workflow
3. Agents execute — reading the issue, analyzing code, making changes, posting comments, opening PRs
4. The workflow completes and moves the issue to the next column (e.g., "Review")
5. The team reviews the agent's work on the board and decides where the issue goes next

## Key concepts

- **Board-driven orchestration** — your project board defines the state machine, Conduit runs the workflows
- **Two node types** — triggers and agents. That's it.
- **MCP servers as tools** — agents call GitHub, Slack, databases, and any MCP-compatible server
- **Skills** — reusable instruction bundles from Claude Code and Codex, attachable to agents
- **Workspace-native** — every agent operates on a git workspace with full file and shell access
- **Multi-agent pipelines** — fan-out, parallel execution, workspace inheritance, sequential merge-back
- **Run observability** — live timeline of agent events (text, tools, tokens) on the run detail page
- **Temporal for durability** — crash recovery, retries, cancellation out of the box

## Development

Prerequisites: Node.js 22 (`nvm use`), npm 10+, Docker.

```bash
nvm use
npm install
cp .env.example .env
npm run infra:up                # Postgres (5434), Temporal (7233 / UI 8080), Redis (6379)
npm run db:push                 # apply Prisma schema
npm run build                   # builds TS dist + the agent-runner Docker image
```

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

### Running the Phase 1 stack

After `infra:up` and `db:push`, boot the three apps in separate terminals:

```bash
npm --workspace @conduit/api dev        # Nest API + Socket.IO on :3001
npm --workspace @conduit/worker dev     # Temporal worker (task queue: conduit-workflows)
npm --workspace @conduit/web dev        # Vite dev server on :5173
```

Open http://localhost:5173, create a workflow, drop an agent, save, and click **Test run**. The run detail page streams `ExecutionLog` events over Socket.IO as the agent executes.

## Documentation

See [docs/INDEX.md](docs/INDEX.md) for the full spec.

## License

[MIT](LICENSE)
