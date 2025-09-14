'use client';
import { useEffect, useState } from 'react';
import { applyTheme, getInitialTheme, persistTheme, ThemeMode } from '../lib/theme';
import { Button } from './ui/Button';

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>('light');
  useEffect(() => {
    const init = getInitialTheme();
    setTheme(init);
  }, []);
  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label="Toggle theme"
      className="rounded-full px-3"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </Button>
  );
}

export default ThemeToggle;
