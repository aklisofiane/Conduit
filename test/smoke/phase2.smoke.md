# Phase 2 smoke — webhook-triggered single-agent run

Exercises the golden path for a webhook-triggered workflow with one agent
node and the run detail streaming surface shipped in Phase 2. Prose-only —
Claude drives Playwright via MCP.

## Setup

1. Ensure the dev stack is up: `npm run infra:up`.
2. Ensure the database is migrated: `npm run db:push`.
3. Start the apps in separate terminals: `npm --workspace @conduit/api dev`,
   `npm --workspace @conduit/worker dev`, `npm --workspace @conduit/web dev`.
   To keep the run deterministic (no real LLM call), export
   `CONDUIT_PROVIDER=stub` for the **api** and **worker** processes — the
   stub replays scripted events but exercises the real run/stream path.
4. Open the web app (typically http://localhost:5173).

## Steps

1. From the workflow list, create a new workflow called
   `Phase 2 smoke — Triage`. Navigate to its canvas.
2. Add a GitHub platform credential (if none exists) and a workflow
   connection with `alias = github-main`, `owner = acme`, `repo = shop`.
3. Click the trigger node. Configure it:
   - Platform: GitHub, Connection: github-main
   - Mode: **Webhook**, event = `issues.opened`
   - Active: checked
     Click **Save changes**.
4. Confirm a **webhook URL** and a **secret** field surface for the trigger
   (the values the GitHub webhook config would use). Set/rotate the secret
   and confirm it persists across a panel reopen.
5. Add an agent node. Open its config panel. Set `Name = Triage`,
   `Instructions = Read the issue and post a triage comment.` Attach the
   GitHub MCP server. Save changes.
6. Confirm the canvas shows the edge `Phase2Trigger → Triage` and the agent
   node footer renders its workspace chip (`ticket-branch` for a
   trigger-anchored node).

## Run detail page

7. Start a manual run from the workflow list, providing an issue reference
   like `42 / Fix crash in checkout`.
8. Open the new run in the run detail page.
9. Top-bar assertion: `trigger`, `started`, `elapsed`, and `tokens` chips
   render. For the ticket-branch node a `branch · conduit/42-…` chip also
   appears.
10. Select the `Triage` node in the left rail. The **Timeline** tab streams
    events live — text deltas, then a `tool_call` entry (e.g.
    `github.add_issue_comment`), then a terminal `done`.
11. When the run finishes, the header status shows **Succeeded /
    COMPLETED**. The **Summary** tab shows the `.conduit/Triage.md` content
    (or a placeholder when the provider wrote none).

## Assertions on visible DOM text

- Trigger panel exposes a webhook URL and a secret control for webhook mode.
- Run detail Timeline shows at least one `tool_call` entry under `Triage`.
- Run header reaches `COMPLETED` (Succeeded) for the happy-path run.
- The agent node footer chip reads `ticket-branch` for the trigger-anchored
  node.
