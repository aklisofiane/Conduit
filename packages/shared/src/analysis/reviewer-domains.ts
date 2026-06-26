/**
 * Bounded reviewer-domain catalog. The Design agent selects **domain keys**
 * only (it chooses *which* domains review a component); this table owns the
 * `instructionsAppend` prose so the generated review prompts stay
 * deterministic and reviewable rather than agent-authored.
 *
 * Assemble code maps each selected key to a `code-analyst` node, injecting
 * `instructionsAppend` exactly the way `templates/nightly-review.json` wires
 * its reviewers today. Mirrors the static-data-table pattern of
 * `mcp/presets.ts` (`MCP_PRESETS` + `findMcpPreset`).
 */
export interface ReviewerDomain {
  /** Stable key the Design agent selects. */
  key: string;
  /** Node name + display label for the generated `code-analyst` node. */
  name: string;
  /** Every domain maps to the `code-analyst` preset. */
  presetId: 'code-analyst';
  /** Prose appended to the preset instructions for this domain. */
  instructionsAppend: string;
}

export const REVIEWER_DOMAINS: readonly ReviewerDomain[] = [
  {
    key: 'security',
    name: 'Security',
    presetId: 'code-analyst',
    instructionsAppend:
      'Your domain is **Security**. Read the ## Security section of `.conduit/ScopeManifest.md`.\n\nLook for:\n- Authentication/authorization bypasses\n- Input validation gaps (injection, XSS, path traversal)\n- Secrets or credentials in code\n- Insecure cryptographic usage\n- Dependency additions with known vulnerabilities\n- Race conditions with security implications\n- Unsafe deserialization',
  },
  {
    key: 'quality',
    name: 'Quality',
    presetId: 'code-analyst',
    instructionsAppend:
      'Your domain is **Quality**. Read the ## Quality section of `.conduit/ScopeManifest.md`.\n\nLook for:\n- Logic errors and bugs\n- Dead code or unreachable branches\n- Missing error handling (unhandled promises, uncaught exceptions)\n- Race conditions\n- Missing or inadequate test coverage for new code paths\n- Incorrect type usage or unsafe casts\n- Resource leaks (unclosed handles, missing cleanup)',
  },
  {
    key: 'refactor',
    name: 'Refactor',
    presetId: 'code-analyst',
    instructionsAppend:
      'Your domain is **Refactor**. Read the ## Refactor section of `.conduit/ScopeManifest.md`.\n\nLook for:\n- Code duplication (same logic in multiple places)\n- High cyclomatic complexity (deeply nested conditionals, long functions)\n- Violations of project conventions (check CLAUDE.md and nearby siblings)\n- Outdated abstractions that the new code works around instead of fixing\n- God objects or functions doing too many things\n- Missing extraction opportunities (repeated patterns that should be shared utilities)',
  },
  {
    key: 'performance',
    name: 'Performance',
    presetId: 'code-analyst',
    instructionsAppend:
      'Your domain is **Performance**. Read the ## Performance section of `.conduit/ScopeManifest.md`.\n\nLook for:\n- N+1 query patterns or missing batch operations\n- Unnecessary memory allocations in hot paths\n- Missing caching opportunities (repeated expensive computations)\n- Expensive operations inside loops\n- Bundle size regressions (large imports that could be lazy-loaded)\n- Missing pagination on unbounded queries\n- Synchronous blocking in async contexts',
  },
  {
    key: 'a11y',
    name: 'Accessibility',
    presetId: 'code-analyst',
    instructionsAppend:
      'Your domain is **Accessibility (a11y)**. Read the ## Accessibility section of `.conduit/ScopeManifest.md`.\n\nLook for:\n- Missing or incorrect ARIA roles, states, and labels\n- Interactive elements that are not keyboard-operable or lack focus management\n- Insufficient color contrast or meaning carried by color alone\n- Images/icons without text alternatives\n- Form inputs without associated labels or error messaging\n- Dynamic content updates that are not announced to assistive technology',
  },
  {
    key: 'bundle-size',
    name: 'BundleSize',
    presetId: 'code-analyst',
    instructionsAppend:
      'Your domain is **Bundle Size**. Read the ## BundleSize section of `.conduit/ScopeManifest.md`.\n\nLook for:\n- Heavy dependencies pulled into client bundles that could be lazy-loaded or replaced\n- Barrel-file imports that defeat tree-shaking\n- Large assets (images, fonts) shipped without optimization\n- Duplicated dependencies across chunks\n- Eagerly-imported code paths that belong behind a dynamic import\n- Polyfills shipped to environments that do not need them',
  },
  {
    key: 'api-contract',
    name: 'ApiContract',
    presetId: 'code-analyst',
    instructionsAppend:
      'Your domain is **API Contract**. Read the ## ApiContract section of `.conduit/ScopeManifest.md`.\n\nLook for:\n- Request/response shapes that drift from their schema or documentation\n- Missing input validation at the API boundary\n- Inconsistent error shapes or status codes across endpoints\n- Backward-incompatible changes to public request/response fields\n- Pagination, filtering, or auth conventions that diverge from sibling endpoints\n- Undocumented or untyped fields crossing the boundary',
  },
  {
    key: 'breaking-change',
    name: 'BreakingChange',
    presetId: 'code-analyst',
    instructionsAppend:
      'Your domain is **Breaking Change**. Read the ## BreakingChange section of `.conduit/ScopeManifest.md`.\n\nLook for:\n- Renamed/removed exported symbols, function signatures, or public types\n- Changed default behavior that callers silently depend on\n- Database schema or migration changes that are not backward-compatible\n- Config/env-var renames or removals without a fallback\n- Wire-format or serialization changes that break older clients\n- Removed or narrowed public API surface without a deprecation path',
  },
];

export type ReviewerDomainKey = (typeof REVIEWER_DOMAINS)[number]['key'];

const DOMAINS_BY_KEY = new Map(REVIEWER_DOMAINS.map((d) => [d.key, d]));

/** Look up a reviewer domain by key. Returns `undefined` for unknown keys. */
export function findReviewerDomain(key: string): ReviewerDomain | undefined {
  return DOMAINS_BY_KEY.get(key);
}
