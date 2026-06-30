/**
 * Theme preference store. The tri-state preference (`system | light | dark`)
 * is persisted to localStorage and resolved to a concrete `light | dark` that
 * is written as `data-theme` on <html>. The first resolution happens in the
 * inline no-flash script in index.html *before* React mounts — keep the
 * storage key and resolution rules here in sync with that script.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'conduit-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* localStorage unavailable (SSR / privacy mode) — fall through */
  }
  return 'system';
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* persistence best-effort; still apply for this session */
  }
  applyTheme(pref);
}
