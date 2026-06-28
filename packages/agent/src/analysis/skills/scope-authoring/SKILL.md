---
name: scope-authoring
description: How to author a strong, component-tailored Scope prompt for a generated review workflow — what the Scope agent does, the ScopeManifest routing concept, and contrasting API-vs-web examples so the prose fits the component's nature.
---

# Scope authoring

The **Scope** agent is the first node of every generated review workflow:

```
Trigger (cron) → Scope → reviewer₁ … reviewerₙ → Publisher
```

It runs on a cadence, looks at what changed in the component over a recent
window, and **routes** that change set to the right reviewers. The reviewers
that fan out from Scope each only review what Scope hands them — so a vague or
mis-routed Scope prompt wastes every downstream reviewer's run.

You author the **`scopeInstructions`** string of the draft: the *substance* of
this agent's job, tailored to what the component actually is.

## The ScopeManifest routing concept

Scope's deliverable is a routing file, `.conduit/ScopeManifest.md`, with **one
`## <ReviewerName>` section per reviewer**. Under each heading it lists the
changed files relevant to that reviewer, with a one-line focus note. Each
reviewer later reads only *its* section. If nothing changed in the window, the
manifest is the single token `NO_CHANGES` and the reviewers stop.

**You do not write the mechanical part of this.** Assemble code appends — onto
your prose — the exact `## <ReviewerName>` headings (derived from the reviewer
list you author), the path-scoping, the precise diff window (derived from the
cron), and the `NO_CHANGES` rule. So **do not** restate the headings, the git
mechanics, the window, or the file path. Instead, author the **judgment**:

- What kinds of change matter in *this* component.
- How to decide which reviewer a given change belongs to.
- What context a reviewer needs in its section to do its job well.

Write so your prose reads naturally *before* the appended mechanical block.

## Tailor to the component's nature

The whole point is that an API scope should not read like a web scope. Inspect
the component and let its nature drive the routing logic.

### Example — an API / service component

> You are scoping a review of the **payments API** service. Identify which
> endpoint handlers, request/response schemas, middleware, and database access
> code changed. Route changes touching authentication, authorization, input
> handling, or secrets to the **Security** reviewer. Route changes to public
> route paths, status codes, response field shapes, or error envelopes to the
> **ApiContract** reviewer — these are what external callers depend on. When a
> change is both (e.g. a new authenticated endpoint), list it under both
> sections with a note on the relevant aspect.

### Example — a web / frontend component

> You are scoping a review of the **dashboard web app**. Identify which
> components, hooks, routes, and styles changed. Route interactive UI changes —
> new controls, forms, dialogs, dynamic content — to the **Accessibility**
> reviewer, noting whether they are keyboard-operable and labelled. Route new or
> upgraded client dependencies and large eager imports to the **BundleSize**
> reviewer. Pure copy or asset-only changes rarely need deep review — note them
> briefly rather than routing them everywhere.

Notice the contrast: the API scope thinks in endpoints, contracts, and trust
boundaries; the web scope thinks in components, interactions, and shipped
bundle weight. Your `scopeInstructions` should sound like it was written for
*this* component specifically.

## Checklist

- [ ] Names the component and what kind of thing it is.
- [ ] Explains, per reviewer, what changes route to it and why.
- [ ] Gives the routing *judgment*, not the mechanical headings/paths/window
      (code appends those).
- [ ] Reads naturally as the opening of a prompt.
