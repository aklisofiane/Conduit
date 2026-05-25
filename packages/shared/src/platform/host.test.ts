import { describe, expect, it } from 'vitest';
import { defaultHostFor, isCloudHost, normalizeHostUrl } from './host';
import type { Platform } from './platform';

// ---------------------------------------------------------------------------
// defaultHostFor
// ---------------------------------------------------------------------------

describe('defaultHostFor', () => {
  it('returns github.com for GITHUB', () => {
    expect(defaultHostFor('GITHUB')).toBe('github.com');
  });

  it('returns gitlab.com for GITLAB', () => {
    expect(defaultHostFor('GITLAB')).toBe('gitlab.com');
  });

  it.each(['JIRA', 'SLACK', 'DISCORD'] as Platform[])(
    'throws for non-VCS platform %s',
    (platform) => {
      expect(() => defaultHostFor(platform)).toThrow(/non-VCS platform/);
    },
  );
});

// ---------------------------------------------------------------------------
// normalizeHostUrl
// ---------------------------------------------------------------------------

describe('normalizeHostUrl', () => {
  describe('VCS platforms (GITHUB, GITLAB)', () => {
    it('falls back to canonical default when input is null', () => {
      expect(normalizeHostUrl(null, 'GITHUB')).toBe('github.com');
      expect(normalizeHostUrl(null, 'GITLAB')).toBe('gitlab.com');
    });

    it('falls back to canonical default when input is undefined', () => {
      expect(normalizeHostUrl(undefined, 'GITHUB')).toBe('github.com');
    });

    it('falls back to canonical default when input is empty string', () => {
      expect(normalizeHostUrl('', 'GITHUB')).toBe('github.com');
    });

    it('falls back to canonical default when input is whitespace', () => {
      expect(normalizeHostUrl('   ', 'GITLAB')).toBe('gitlab.com');
    });

    it('lowercases the hostname', () => {
      expect(normalizeHostUrl('GHE.Example.Com', 'GITHUB')).toBe(
        'ghe.example.com',
      );
    });

    it('strips https:// prefix', () => {
      expect(normalizeHostUrl('https://ghe.example.com', 'GITHUB')).toBe(
        'ghe.example.com',
      );
    });

    it('strips http:// prefix', () => {
      expect(normalizeHostUrl('http://ghe.example.com', 'GITHUB')).toBe(
        'ghe.example.com',
      );
    });

    it('strips trailing slash', () => {
      expect(normalizeHostUrl('ghe.example.com/', 'GITHUB')).toBe(
        'ghe.example.com',
      );
    });

    it('strips multiple trailing slashes', () => {
      expect(normalizeHostUrl('ghe.example.com///', 'GITHUB')).toBe(
        'ghe.example.com',
      );
    });

    it('strips scheme AND trailing slash combined', () => {
      expect(normalizeHostUrl('https://ghe.example.com/', 'GITHUB')).toBe(
        'ghe.example.com',
      );
    });

    it('accepts a valid bare hostname', () => {
      expect(normalizeHostUrl('ghe.example.com', 'GITHUB')).toBe(
        'ghe.example.com',
      );
    });

    it('accepts a valid hostname with port', () => {
      expect(normalizeHostUrl('gitlab.acme.io:8443', 'GITLAB')).toBe(
        'gitlab.acme.io:8443',
      );
    });

    it('accepts port 1 (minimum)', () => {
      expect(normalizeHostUrl('host.example.com:1', 'GITHUB')).toBe(
        'host.example.com:1',
      );
    });

    it('accepts port 65535 (maximum)', () => {
      expect(normalizeHostUrl('host.example.com:65535', 'GITHUB')).toBe(
        'host.example.com:65535',
      );
    });

    it('rejects port 0', () => {
      expect(() =>
        normalizeHostUrl('host.example.com:0', 'GITHUB'),
      ).toThrow(/malformed hostname/);
    });

    it('rejects port > 65535', () => {
      expect(() =>
        normalizeHostUrl('host.example.com:65536', 'GITHUB'),
      ).toThrow(/port 65536 out of range/);
    });

    it('rejects subpath deployments', () => {
      expect(() =>
        normalizeHostUrl('gitlab.example.com/gitlab', 'GITLAB'),
      ).toThrow(/subpath deployments are not supported/);
    });

    it('rejects subpath even after scheme stripping', () => {
      expect(() =>
        normalizeHostUrl('https://gitlab.example.com/gitlab', 'GITLAB'),
      ).toThrow(/subpath deployments are not supported/);
    });

    it('rejects invalid characters', () => {
      expect(() =>
        normalizeHostUrl('host_bad!.com', 'GITHUB'),
      ).toThrow(/malformed hostname/);
    });

    it('rejects hostname with leading hyphen in a label', () => {
      expect(() =>
        normalizeHostUrl('-bad.example.com', 'GITHUB'),
      ).toThrow(/malformed hostname/);
    });
  });

  describe('non-VCS platforms', () => {
    it.each(['JIRA', 'SLACK', 'DISCORD'] as Platform[])(
      'returns null for %s regardless of input',
      (platform) => {
        expect(normalizeHostUrl('anything.example.com', platform)).toBeNull();
        expect(normalizeHostUrl(null, platform)).toBeNull();
        expect(normalizeHostUrl('', platform)).toBeNull();
      },
    );
  });
});

// ---------------------------------------------------------------------------
// isCloudHost
// ---------------------------------------------------------------------------

describe('isCloudHost', () => {
  it('returns true for github.com + GITHUB', () => {
    expect(isCloudHost('GITHUB', 'github.com')).toBe(true);
  });

  it('returns true for gitlab.com + GITLAB', () => {
    expect(isCloudHost('GITLAB', 'gitlab.com')).toBe(true);
  });

  it('returns false for self-hosted GITHUB', () => {
    expect(isCloudHost('GITHUB', 'ghe.example.com')).toBe(false);
  });

  it('returns false for self-hosted GITLAB', () => {
    expect(isCloudHost('GITLAB', 'gitlab.acme.io')).toBe(false);
  });

  it('returns false for non-VCS platforms', () => {
    expect(isCloudHost('JIRA', 'jira.example.com')).toBe(false);
  });
});
