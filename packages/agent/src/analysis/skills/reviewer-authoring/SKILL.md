---
name: reviewer-authoring
description: How to author component-specific reviewer prompts for a generated review workflow — a menu of common review lenses (security, quality, refactor, performance, a11y, bundle-size, api-contract, breaking-change) to draw from and adapt, plus the findings-output conventions code appends.
---

# Reviewer authoring

Each generated review workflow fans out from Scope to one or more **reviewer**
agents. You author the set: for each reviewer you choose a `name` and write its
`instructions` — the _substance_ of what it reviews, tailored to this component.

```
Scope → reviewer₁ … reviewerₙ → Publisher
```

Pick reviewers that fit the component. An API benefits from a `Security` and an
`ApiContract` reviewer; a web app from `Accessibility` and `BundleSize`; a
library from `BreakingChange`. Two to four focused reviewers usually beats one
catch-all. Each reviewer should have a clear, non-overlapping remit so Scope can
route cleanly.

## What you author vs. what code appends

You author **what to review**. Code owns **where to read and write, and the
output format**. Assemble appends — onto each reviewer's prose — the contract
glue: read the `## <YourName>` section of `.conduit/ScopeManifest.md`; if it is
empty or `NO_CHANGES`, write "No findings" and stop; otherwise write findings to
`.conduit/<YourName>.md` in a fixed `## Findings` / `Severity:` format that the
downstream Publisher's severity gate parses.

So **do not** restate the file paths, the manifest-read step, or the findings
format in your `instructions`. Write only the domain judgment — the kinds of
problem this reviewer hunts for in this component. Severity still matters
conceptually: the Publisher only surfaces `medium`/`high`/`critical` findings,
so steer reviewers toward real, consequential issues rather than nitpicks.

## A menu of common review lenses

These are _inspiration, not a fixed set_. Draw from them, adapt the wording to
the component, combine them, or **invent new ones** the menu doesn't cover — a
CLI component might warrant an `ArgParsing` reviewer; a data pipeline a
`SchemaEvolution` reviewer; an infra component a `Secrets` or `Idempotency`
reviewer. The reviewer `name` is free-form (within the charset rule in the
`draft-format` skill); the instructions are yours to write.

### Security

Authentication / authorization bypasses; input-validation gaps (injection, XSS,
path traversal); secrets or credentials in code; insecure cryptographic usage;
dependency additions with known vulnerabilities; race conditions with security
implications; unsafe deserialization.

### Quality

Logic errors and bugs; dead code or unreachable branches; missing error handling
(unhandled promises, uncaught exceptions); race conditions; missing or
inadequate test coverage for new code paths; incorrect type usage or unsafe
casts; resource leaks (unclosed handles, missing cleanup).

### Refactor

Code duplication (same logic in multiple places); high cyclomatic complexity
(deeply nested conditionals, long functions); violations of project conventions
(check CLAUDE.md and nearby siblings); outdated abstractions the new code works
around instead of fixing; god objects or functions doing too many things;
missing extraction opportunities (repeated patterns that should be shared
utilities).

### Performance

N+1 query patterns or missing batch operations; unnecessary memory allocations
in hot paths; missing caching opportunities (repeated expensive computations);
expensive operations inside loops; bundle-size regressions (large imports that
could be lazy-loaded); missing pagination on unbounded queries; synchronous
blocking in async contexts.

### Accessibility (a11y)

Missing or incorrect ARIA roles, states, and labels; interactive elements that
are not keyboard-operable or lack focus management; insufficient color contrast
or meaning carried by color alone; images/icons without text alternatives; form
inputs without associated labels or error messaging; dynamic content updates not
announced to assistive technology.

### Bundle size

Heavy dependencies pulled into client bundles that could be lazy-loaded or
replaced; barrel-file imports that defeat tree-shaking; large assets (images,
fonts) shipped without optimization; duplicated dependencies across chunks;
eagerly-imported code paths that belong behind a dynamic import; polyfills
shipped to environments that do not need them.

### API contract

Request/response shapes that drift from their schema or documentation; missing
input validation at the API boundary; inconsistent error shapes or status codes
across endpoints; backward-incompatible changes to public request/response
fields; pagination, filtering, or auth conventions that diverge from sibling
endpoints; undocumented or untyped fields crossing the boundary.

### Breaking change

Renamed/removed exported symbols, function signatures, or public types; changed
default behavior callers silently depend on; database schema or migration
changes that are not backward-compatible; config/env-var renames or removals
without a fallback; wire-format or serialization changes that break older
clients; removed or narrowed public API surface without a deprecation path.

## Worked example — composing for a component

For a `cli` component you might author three reviewers: a `Quality` reviewer
adapted from the menu, a `BreakingChange` reviewer focused on flag/output
stability, and an invented `ArgParsing` reviewer:

> **ArgParsing** — Review changes to command and flag definitions for breaking
> renames of flags or subcommands, missing validation of user-supplied
> arguments, inconsistent flag naming versus sibling commands, and help/usage
> text that no longer matches behavior.

## Checklist

- [ ] One to four reviewers, each with a clear non-overlapping remit.
- [ ] Names fit the charset rule (see `draft-format`) and are unique.
- [ ] Each `instructions` says _what to look for_, tailored to this component.
- [ ] No restating of file paths / manifest-read / findings format (code appends those).
- [ ] Lenses chosen/composed/invented to fit the component, not copied wholesale.
