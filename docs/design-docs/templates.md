# Workflow Templates

Pre-built workflow blueprints shipped with Conduit to help users get started quickly. Templates are starting points, not runtime entities.

## How it works

1. Templates live as JSON files in `/templates/` at the repo root.
2. API endpoint `GET /api/templates` reads the directory and returns the list (name, description, category).
3. User clicks "Create from template" in the UI and picks one.
4. `POST /api/workflows/from-template/:templateId` reads the template file and creates a fresh `Workflow` row with the template's `definition` copied in.
5. From that point on, the new workflow is a normal DB row — fully editable, independent of the template file.

Templates are **static seed data**, not first-class DB entities. They never link back to the workflows created from them. Editing a template file doesn't affect existing workflows.

## File shape

```json
{
  "id": "analyze",
  "name": "Analyze",
  "description": "Review a new issue's intent and propose an implementation approach based on the source code.",
  "category": "triage",
  "definition": {
    "trigger": { /* TriggerConfig */ },
    "nodes": [ /* Node[] */ ],
    "edges": [ /* Edge[] */ ],
    "mcpServers": [ /* WorkflowMcpServer[] */ ],
    "ui": { /* CanvasUI — node positions, viewport */ }
  }
}
```

The `definition` object matches `Workflow.definition` in the DB. Same Zod schema validates both — templates that fail validation at startup are logged and skipped.

**Credential references**: template definitions reference `connectionId` placeholders (e.g., `"connectionId": "<github>"`). When the user creates a workflow from the template, the UI prompts them to bind each placeholder to a real `WorkflowConnection` before saving.

## Templates shipped with v1

| Template | Trigger | Pipeline |
|---|---|---|
| `analyze` | GitHub `issues.opened` | Single agent — reads the issue, inspects the source code, posts a comment with a proposed approach, moves issue to "Analyzed" column |
| `develop` | Polling trigger on `status = "Dev"` | Multi-agent parallel: Dev agent + Test agent + Docs agent running in parallel with workspace fan-out → merge-back → QA/Review agent consumes the merged workspace and opens a PR |
| `pr-review` | GitHub `pull_request.opened` | Single agent — reviews the PR diff, posts inline comments and a summary review |

## Why static files, not DB

- **No schema changes** — templates don't need a DB table for v1.
- **Version-controlled** — templates live with the code, evolve via PRs.
- **Simple invalidation** — editing a template file doesn't affect existing workflows (they were copied at creation time).
- **Easy to add new ones** — just drop a JSON file in `/templates/`.

If user-created templates become a feature later, upgrade path is: add a `WorkflowTemplate` DB table, seed it from the JSON files on boot, accept user contributions via API. The UI and `from-template` flow don't change.
