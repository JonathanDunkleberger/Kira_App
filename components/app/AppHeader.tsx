'use client';
import { useState } from 'react';
import { Sun, Moon, User, Settings, CreditCard, LogOut } from 'lucide-react';
import { useTheme } from 'next-themes';

import HeaderPanels, { type Panel } from './HeaderPanels';
import TopClockTimer from '@/components/TopClockTimer';
import { supaBrowser } from '@/lib/supabase-browser';

export default function AppHeader() {
  const { theme, setTheme } = useTheme();
  const [panel, setPanel] = useState<Panel>(null);

  async function handleBilling() {
    try {
      const supa = supaBrowser();
      const { data } = await supa.auth.getUser();
      if (!data.user) {
        setPanel('auth');
      } else {
        setPanel('billing');
      }
    } catch {
      setPanel('auth');
    }
  }

  return (
  <header className="relative h-12 flex items-center justify-center bg-transparent">
      <TopClockTimer />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
        <div className="relative group">
          <button
            aria-label="Open account menu"
            className="h-8 w-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium hover:bg-primary/30 transition"
            onClick={() => setPanel('profile')}
          >
            <User className="h-4 w-4" />
          </button>
        </div>
        <button
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="h-8 w-8 rounded-full border border-border flex items-center justify-center text-foreground hover:bg-muted transition"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div className="relative">
          <button
            onClick={() => setPanel('settings')}
            className="h-8 w-8 rounded-full border border-border flex items-center justify-center hover:bg-muted"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={handleBilling}
          className="h-8 w-8 rounded-full border border-border flex items-center justify-center hover:bg-muted"
          aria-label="Billing"
        >
          <CreditCard className="h-4 w-4" />
        </button>
        <button
          onClick={() => (window.location.href = '/logout')}
          className="h-8 w-8 rounded-full border border-border flex items-center justify-center hover:bg-muted"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      <HeaderPanels panel={panel} onOpenChange={(o) => !o && setPanel(null)} />
    </header>
  );
}
