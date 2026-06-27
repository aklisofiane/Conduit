---
name: draft-format
description: The exact WorkflowDraft JSON shape a Design agent must write to .conduit/WorkflowDraft.json — field-by-field reference with the reviewer-name charset rule and a complete worked example, to avoid JSON validation mistakes.
---

# Draft format — `WorkflowDraft`

When you finish designing a review workflow for one component, you emit a single
JSON object — the **`WorkflowDraft`** — to the fixed path:

```
.conduit/WorkflowDraft.json
```

Write **only valid JSON** to that file: one object, no Markdown fences, no
prose, no trailing comments, no surrounding text. The file is parsed and
validated with a strict schema; a malformed draft is rejected and the whole
Design step re-runs.

## Fields

Every field is required. None may be empty.

| Field | Type | Meaning |
| --- | --- | --- |
| `component` | string (non-empty) | Echo of the component name you were asked to design for. Must match the `Component.name` you were given. |
| `workflowName` | string (non-empty) | Human-facing workflow title shown on the suggestion card (e.g. `"API review"`). |
| `summary` | string (non-empty) | One line: *what this workflow reviews*. Shown on the gallery card. |
| `rationale` | string (non-empty) | One or two sentences: *why these reviewers and this cadence*. Shown on the card. |
| `scopeInstructions` | string (non-empty) | The prose body of the **Scope** agent's prompt. See the `scope-authoring` skill. |
| `reviewers` | array, **min 1** | One entry per reviewer agent. See below. |
| `cron` | string | 5-field POSIX cron cadence (e.g. `"0 6 * * 1"` = 06:00 every Monday). |
| `paths` | array of strings, **min 1** | The component's path glob(s) the review is scoped to (e.g. `["apps/api/**"]`). |

### `reviewers[]`

Each reviewer is an object with exactly two fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string (constrained — see below) | The reviewer's identity. |
| `instructions` | string (non-empty) | The prose body of that reviewer agent's prompt. See the `reviewer-authoring` skill. |

You must provide **at least one** reviewer. Names must be **unique within the
draft**.

## Reviewer `name` charset rule (strict)

A reviewer `name` is reused verbatim in three structural places: it becomes a
workflow **node name** (and the graph edge endpoints referencing it), a
`.conduit/<name>.md` **findings filename**, and a `## <name>` **heading** in the
routing manifest. Because of the node-name use, it must match exactly:

```
/^[A-Za-z_][A-Za-z0-9_]*$/
```

That means: **letters, digits, and underscores only**, and it **may not start
with a digit**. No spaces, no hyphens, no punctuation, no accents.

Valid: `Security`, `ApiContract`, `WebSecurity`, `Performance`, `Arg_Parsing`,
`A11y` (note: must start with a letter, so `A11y` is fine but `11y` is not).

Invalid: `API Contract` (space), `bundle-size` (hyphen), `2fa` (leading digit),
`a11y!` (punctuation). Use PascalCase or snake_case to compose multi-word
names: `ApiContract`, `BundleSize`, `bundle_size`.

If a name violates this pattern the draft fails validation. Prefer short
PascalCase names.

## What you author vs. what code appends

You author the *substance* — `scopeInstructions` and each reviewer's
`instructions`. You do **not** write the mechanical I/O contract (which file to
read, which `## Heading` to look under, the findings/severity output format, the
diff window). Assemble code appends that deterministic glue onto your prose
after the draft is read, derived from the reviewer list you emit. Focus on
*what to look for*, tailored to this component; let the code own *where to
read/write and the exact format*.

## Worked example

For a component named `API` (paths `apps/api/**`) with two reviewers:

```json
{
  "component": "API",
  "workflowName": "API review",
  "summary": "Weekly review of the public HTTP API surface and its auth boundary.",
  "rationale": "The API is high-criticality and changes weekly; security and contract drift are the two failure modes that hurt callers most.",
  "scopeInstructions": "You are scoping a review of the API service. Identify which endpoint handlers, request/response schemas, and middleware changed, and route security-relevant changes (auth, input handling, secrets) to the Security reviewer and public-shape changes (routes, status codes, response fields) to the ApiContract reviewer.",
  "reviewers": [
    {
      "name": "Security",
      "instructions": "Review the changed API code for authentication and authorization bypasses, missing input validation at the request boundary (injection, path traversal), secrets committed to source, and insecure handling of untrusted payloads. The auth middleware and any new public endpoint are the highest-risk surfaces."
    },
    {
      "name": "ApiContract",
      "instructions": "Review the changed endpoints for backward-incompatible changes to public request/response fields, status codes, and error shapes; for missing validation at the boundary; and for divergence from the conventions of sibling endpoints (pagination, auth, error envelope)."
    }
  ],
  "cron": "0 6 * * 1",
  "paths": ["apps/api/**"]
}
```

## Checklist before you write

- [ ] Output is a single JSON object, nothing else, at `.conduit/WorkflowDraft.json`.
- [ ] Every field present and non-empty.
- [ ] `reviewers` has at least one entry.
- [ ] Every reviewer `name` matches `/^[A-Za-z_][A-Za-z0-9_]*$/` and is unique.
- [ ] `paths` echoes this component's globs (at least one).
- [ ] `cron` is a valid 5-field expression.
