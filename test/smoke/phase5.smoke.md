# Phase 5 — Ticket-branch workspace smoke

Exercises the golden path for the `ticket-branch` workspace kind and the
board-loop UI surfaces shipped in Phase 5. Prose-only — Claude drives
Playwright via MCP.

## Setup

1. Ensure the dev stack is up: `npm run infra:up`.
2. Ensure the database is migrated: `npm run db:push`.
3. Start the apps in separate terminals: `npm --workspace @conduit/api dev`, `npm --workspace @conduit/worker dev`, `npm --workspace @conduit/web dev`.
4. Open the web app (typically http://localhost:5173).

## Steps

1. Create a new workflow called `Phase 5 smoke — Worker`. Accept the default
   definition. Navigate to the canvas for the new workflow.
2. Add a GitHub platform credential (if one does not already exist) and a
   workflow connection with `alias = github-main`, `owner = acme`, `repo = shop`.
3. Back on the canvas, click the trigger node. Configure the trigger:
   - Platform: GitHub, Connection: github-main
   - Mode: **Polling**, Interval: 60
   - Project board: Org, owner = acme, number = 1
   - Filters: `field = status`, `op = eq`, `value = Dev`
   - Active: checked
   Click **Save changes**.
4. Add an agent node. Open its config panel.
5. In the **Workspace** select verify the `ticket-branch` option is present
   **without a "(coming soon)" suffix** — picking it should not crash.
6. Select `ticket-branch`. The agent node renders `ticket-branch` in its
   footer chip.
7. Fill in `Name = Worker`, `Instructions = Worker node — commit and push to
   the conduit/<ticket> branch.` Save changes.

## Validation (save-time)

8. Change the trigger mode to **Webhook**, event = `board.column.changed`,
   keep the same ticket-branch agent. Click **Save changes**.
9. Expect a 400-style error surfaced in the UI (toast or inline) whose body
   mentions `ticket-branch` and `board.column.changed`. The workflow should
   **not** have activated. Verify by reloading — the definition still shows
   the previous (polling) trigger, or the webhook combo is rejected.
10. Revert the trigger back to Polling as in step 3. Save and confirm no
    error renders.

## Run detail page

11. With the workflow saved and active, start a manual run from the
    workflows list. Provide an issue reference like `42 / Fix crash in
    checkout` so the trigger event carries a ticket identifier.
12. Open the new run in the run detail page.
13. Top-bar assertion: a `branch · conduit/42-fix-crash-in-checkout` chip
    appears alongside the existing `trigger`, `started`, `elapsed`, and
    `tokens` chips. The chip only renders when at least one node has a
    ticket-branch workspace.
14. Select the `Worker` node in the left rail. The **Timeline** tab
    streams events. The **Summary** tab shows the `.conduit/Worker.md`
    placeholder (since the real provider wrote none).

## Duplicate-drop visible UX

15. From the workflows list, click **Run** on the same workflow with the
    same issue a second time while the first run is still `RUNNING`.
16. The duplicate trigger should be dropped silently (no new run row
    appears in the `Runs` list for the workflow). Manual runs against an
    in-flight ticket-branch workflow surface as either a soft-drop
    notification or no visible change — the in-flight run continues.

## Assertions on visible DOM text

- Agent config workspace select contains the literal `ticket-branch`
  option, no `(coming soon)` suffix.
- Run detail header renders `branch · conduit/<id>-<slug>` for
  ticket-branch runs and omits the chip for `repo-clone` / `inherit` runs.
- Save-time rejection message contains both `ticket-branch` and
  `board.column.changed`.
