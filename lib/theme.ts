export type ThemeMode = 'light' | 'dark';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') return saved;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function persistTheme(t: ThemeMode) {
  try {
    localStorage.setItem('theme', t);
  } catch {}
}

export function applyTheme(t: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('theme-dark', t === 'dark');
}
