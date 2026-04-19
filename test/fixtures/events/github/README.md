# GitHub webhook fixtures

Trimmed-but-realistic payloads used by `packages/shared/src/webhook/github.fixtures.test.ts` and the Phase 2 E2E. They mirror the shape of real GitHub webhook deliveries; unused fields (author avatars, reaction counts, etc.) are dropped to keep the fixtures readable.

| File | Event header | Action | Normalizes to |
|---|---|---|---|
| `issues.opened.json` | `issues` | `opened` | `issues.opened` |
| `issues.closed.json` | `issues` | `closed` | `null` (unsupported action) |
| `pull_request.opened.json` | `pull_request` | `opened` | `pull_request.opened` |
| `issue_comment.pr.json` | `issue_comment` | `created` | `issue_comment.created` (PR-scoped) |
| `issue_comment.issue.json` | `issue_comment` | `created` | `null` (issue-only — not routed in v1) |
| `push.json` | `push` | — | `null` (unsupported event type) |
| `issues.opened.no-repo.json` | `issues` | `opened` | `issues.opened` with `repo` omitted |

## Rules

- Keep the `repository.owner.login` and `repository.name` stable as `acme/shop` across fixtures. Tests rely on that identity.
- When adding a new event type, capture a real delivery via `gh webhook forward` or the GitHub webhook-settings "Recent Deliveries" pane, then trim to the fields the normalizer touches + one or two adjacent ones for realism.
- Add a matching row to the fixtures test so the normalizer is locked to the on-disk shape.
