# Workflow Templates

Pre-built workflow blueprints shipped with Conduit to help users get started quickly. Templates are starting points, not runtime entities.

## How it works

1. Templates live as JSON files in `/templates/` at the repo root.
2. API endpoint `GET /api/templates` reads the directory and returns the list (id, name, description, category, contained workflow count).
3. User clicks "Create from template" in the UI and picks one.
4. `POST /api/workflows/from-template/:templateId` reads the template file and creates one or more fresh `Workflow` rows atomically (in a single transaction) from the template's `workflows` array.
5. From that point on, the new workflows are normal DB rows — fully editable, independent of the template file.

Templates are **static seed data**, not first-class DB entities. They never link back to the workflows created from them. Editing a template file doesn't affect existing workflows.

A template can contain **one or more workflow definitions**. Single-workflow templates (`analyze`, `pr-review`) have a one-element `workflows` array; multi-workflow bundles (`board-loop`'s Worker + Critic pair) ship multiple definitions that share connection bindings and are created together.

## File shape

```json
{
  "id": "analyze",
  "name": "Analyze",
  "description": "Review a new issue's intent and propose an implementation approach based on the source code.",
  "category": "triage",
  "workflows": [
    {
      "name": "Analyze",
      "description": "...",
      "definition": {
        "trigger": { /* TriggerConfig */ },
        "nodes": [ /* Node[] */ ],
        "edges": [ /* Edge[] */ ],
        "mcpServers": [ /* WorkflowMcpServer[] */ ],
        "ui": { /* CanvasUI — node positions, viewport */ }
      }
    }
  ]
}
```

Each entry's `definition` matches `Workflow.definition` in the DB. Same Zod schema validates both — templates that fail validation at startup are logged and skipped. The template's top-level `name`/`description`/`category` describe the bundle; each entry's `name`/`description` become the created `Workflow` row's fields.

**Credential references**: template definitions reference `connectionId` placeholders (e.g., `"connectionId": "<github>"`). Placeholders are **bundle-scoped** — the same `<github>` placeholder used in multiple workflows of a bundle binds to the same real `WorkflowConnection`. When the user creates from a template, the UI prompts once per unique placeholder, then each workflow is created with its connection references resolved.

## Templates shipped with v1

| Template | Workflows | Pipeline |
|---|---|---|
| `analyze` | 1 | GitHub `issues.opened` → single agent reads the issue, inspects the source code, posts a comment with a proposed approach, moves the issue to "Analyzed" |
| `develop` | 1 | Polling on `status = "Dev"` → multi-agent parallel: Dev + Test + Docs agents fan out → merge-back → QA/Review agent consumes the merged workspace and opens a PR |
| `pr-review` | 1 | GitHub `pull_request.opened` → single agent reviews the PR diff, posts inline comments and a summary review |
| `board-loop` | 2 | **Worker** (polling on `status = "Dev"` → `ticket-branch` agent commits and pushes, opens a draft PR on first push, moves to `"AIReview"`) + **Critic** (polling on `status = "AIReview"` → reads the branch / PR, either approves or moves back to `"Dev"` to re-trigger the Worker). Shares a GitHub connection placeholder. |

## Why static files, not DB

- **No schema changes** — templates don't need a DB table for v1.
- **Version-controlled** — templates live with the code, evolve via PRs.
- **Simple invalidation** — editing a template file doesn't affect existing workflows (they were copied at creation time).
- **Easy to add new ones** — just drop a JSON file in `/templates/`.

If user-created templates become a feature later, upgrade path is: add a `WorkflowTemplate` DB table, seed it from the JSON files on boot, accept user contributions via API. The UI and `from-template` flow don't change.
