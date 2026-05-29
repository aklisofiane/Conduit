## Marker contract (mandatory)

Every body Conduit publishes — issue body, PR description, ticket — MUST wrap the Conduit-generated content between these exact markers, one block per body:

```
<!-- conduit:start -->
…Conduit content goes here…
<!-- conduit:end -->
```

Rewrite rules on rerun:

- If a `<!-- conduit:start --> … <!-- conduit:end -->` block already exists in the target body, locate it and replace ONLY the content between the markers. The markers themselves stay; everything outside them (user-authored prose, headings, links) is untouched.
- If no block exists, append a fresh block at the end of the body.
- Never emit more than one block per body. Never alter the marker strings — downstream reruns rely on exact-string matching.
- Block contents are entirely yours to structure; the marker contract owns only the wrapper.
