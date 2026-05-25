import type { Platform } from './platform';

// ---------------------------------------------------------------------------
// VCS platform subset
// ---------------------------------------------------------------------------

const VCS_PLATFORMS = new Set<Platform>(['GITHUB', 'GITLAB']);

const CLOUD_DEFAULTS: Partial<Record<Platform, string>> = {
  GITHUB: 'github.com',
  GITLAB: 'gitlab.com',
};

// ---------------------------------------------------------------------------
// Validation regex
// ---------------------------------------------------------------------------

/**
 * Bare hostname with optional `:port`. No scheme, no path, no trailing slash.
 *
 * Valid examples: `github.com`, `ghe.example.com`, `gitlab.acme.io:8443`
 * Invalid: `https://github.com`, `github.com/`, `github.com/subpath`
 */
const HOST_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[1-9][0-9]{0,4})?$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the canonical cloud hostname for a VCS platform.
 * Throws for non-VCS platforms (`JIRA`, `SLACK`, `DISCORD`).
 */
export function defaultHostFor(platform: Platform): string {
  const host = CLOUD_DEFAULTS[platform];
  if (!host) {
    throw new Error(`No default host for non-VCS platform: ${platform}`);
  }
  return host;
}

/**
 * Normalize a user-supplied host URL into the canonical storage format:
 * lowercase, no scheme, no trailing slash, validated against the hostname
 * regex.
 *
 * - **VCS platforms** (`GITHUB`, `GITLAB`): trims, lowercases, strips
 *   `https://` prefix and trailing slash, validates. Falls back to the
 *   canonical cloud default when `input` is null/undefined/empty.
 * - **Non-VCS platforms**: always returns `null` regardless of input.
 *
 * Throws on malformed input (subpaths, invalid characters, port out of range).
 */
export function normalizeHostUrl(
  input: string | null | undefined,
  platform: Platform,
): string | null {
  if (!VCS_PLATFORMS.has(platform)) return null;

  let host = (input ?? '').trim().toLowerCase();

  // Strip scheme if accidentally supplied.
  host = host.replace(/^https?:\/\//, '');

  // Strip trailing slash(es).
  host = host.replace(/\/+$/, '');

  // Empty after cleanup → canonical cloud default.
  if (host === '') return defaultHostFor(platform);

  // Reject subpaths (anything with a slash remaining after scheme/trailing removal).
  if (host.includes('/')) {
    throw new Error(
      `Invalid host URL "${input}": subpath deployments are not supported`,
    );
  }

  // Validate hostname + optional port regex.
  if (!HOST_RE.test(host)) {
    throw new Error(`Invalid host URL "${input}": malformed hostname`);
  }

  // Range-check port if present.
  const colonIdx = host.lastIndexOf(':');
  if (colonIdx !== -1) {
    const port = Number(host.slice(colonIdx + 1));
    if (port < 1 || port > 65535) {
      throw new Error(
        `Invalid host URL "${input}": port ${port} out of range (1-65535)`,
      );
    }
  }

  return host;
}

/**
 * Returns `true` when `hostUrl` is the canonical cloud host for the given
 * VCS platform (e.g. `github.com` for `GITHUB`).
 */
export function isCloudHost(platform: Platform, hostUrl: string): boolean {
  return CLOUD_DEFAULTS[platform] === hostUrl;
}
