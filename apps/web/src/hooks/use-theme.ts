import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  getThemePref,
  setThemePref as persistThemePref,
  type ThemePref,
} from '../lib/theme.js';

/**
 * Reads and writes the theme preference. The concrete `data-theme` is already
 * set on <html> by the no-flash script in index.html, so this hook only owns
 * subsequent changes plus live-following the OS while the preference is
 * `system` (so flipping the OS appearance updates the app without a reload).
 */
export function useTheme(): { pref: ThemePref; setPref: (next: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(() => getThemePref());

  const setPref = useCallback((next: ThemePref) => {
    persistThemePref(next);
    setPrefState(next);
  }, []);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  return { pref, setPref };
}
