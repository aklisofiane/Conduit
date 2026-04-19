# Phase 6 smoke — template picker

Prereq: dev stack running (`npm run infra:up` + `npm run dev`) and at least one GitHub credential saved.

1. Navigate to `http://localhost:5173/` — the workflow list appears.
2. Click **"From template"** in the header row of the workflow list.
3. Confirm the dialog opens with the title "Start from a template" and lists four cards — `Analyze`, `PR Review`, `Develop`, `Board Loop (Worker + Critic)`.
4. Click the **`Board Loop (Worker + Critic)`** card.
5. The dialog title changes to "Configure Board Loop (Worker + Critic)" and shows "2 workflows · 1 connection to bind".
6. A single `<github>` binding row is visible. Default mode is **New**. Alias defaults to `github`, and the credential dropdown is pre-populated with the first saved credential.
7. Optionally type `acme` into Owner and `shop` into Repo.
8. Click **"Create 2 workflows"** in the footer.
9. The dialog closes and the browser navigates to `/workflows/<id>` for the first created workflow (Worker).
10. Navigate back to `/` — the workflow list now shows **Worker** and **Critic** as two new rows, both **off** (paused — activate from the canvas).
11. Open each new workflow's **Connections** page (`/workflows/:id/connections`) and verify a `github` connection exists on both, bound to the same credential.
