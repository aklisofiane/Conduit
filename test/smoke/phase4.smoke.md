# Phase 4 — Trigger config panel smoke

Exercises the golden path for the new polling trigger UI shipped in Phase 4.
Prose-only — Claude drives Playwright via MCP.

## Setup

1. Ensure the dev stack is up: `npm run infra:up`.
2. Ensure the database is migrated: `npm run db:push`.
3. Start the apps in separate terminals: `npm --workspace @conduit/api dev`, `npm --workspace @conduit/worker dev`, `npm --workspace @conduit/web dev`.
4. Open the web app (typically http://localhost:5173).

## Steps

1. Create a new workflow called `Phase 4 smoke`. Accept the default definition.
2. Navigate to the canvas for the new workflow.
3. Before the trigger panel has context, add a GitHub platform credential + a workflow connection with `alias = github-main`, `owner = acme`, `repo = shop`. (The panel's connection dropdown reads this list.)
4. Back on the canvas, click the trigger node. Assert the right-hand panel title reads `polling · config` or `webhook · config`.
5. Verify the **Platform** select shows `GitHub` as selected. GitLab and Jira options should be visibly disabled.
6. Verify the **Connection** dropdown lists the `github-main` connection just created.
7. Click the **Polling** button in the **Mode** toggle. Assert:
   - A numeric **Interval** input appears (default 60, minimum 10).
   - The **Project board** fieldset appears with an `Org/User` segmented control, an `owner` text input, and a `#` number input.
8. Fill in `ownerType = Org`, `owner = acme`, `number = 5`.
9. In the **Filters** section click `+ Add filter`, set `field = status`, `op = eq`, `value = Dev`.
10. Confirm the **Active** checkbox is toggleable and reflects the label text (`active — receiving events` vs `paused`).
11. Click **Save changes**. Assert the top-bar `Save` button flips to `Saved` and no errors render.
12. Reload the page and re-open the trigger panel. All the fields above should have persisted.
13. Switch **Mode** back to **Webhook**. Assert:
    - **Interval** and **Project board** fieldsets disappear (unless the webhook `event` is `board.column.changed`).
    - **Event** select appears with `issues.opened` selected.
    - Change the event to `board.column.changed` and assert the **Project board** fieldset reappears.
14. Click **Discard** to revert. Assert the button disables (no dirty state).

## Assertions on visible DOM text

- Panel header shows `Trigger · github`.
- Mode toggle buttons read `Webhook` and `Polling`.
- Filter rows have a delete button (`×`) that removes the row.
- Empty-state message `No filters — every matching event fires the workflow.` appears when no filters are configured.
