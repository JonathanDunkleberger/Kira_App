"use client";
import { useCallback, useEffect, useState } from 'react';
import { applyTheme, getInitialTheme, persistTheme, ThemeMode } from './theme';

export function useTheme(): [ThemeMode, (t: ThemeMode) => void, { toggle: () => void }] {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    // Sync across tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    // Respond to system change if user hasn't explicitly chosen (only if key absent)
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const saved = localStorage.getItem('theme');
      if (!saved) {
        setTheme(mq.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', onChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      mq.removeEventListener('change', onChange);
    };
  }, []);

  const set = useCallback((t: ThemeMode) => setTheme(t), []);
  const toggle = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);

  return [theme, set, { toggle }];
}
