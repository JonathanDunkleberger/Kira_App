'use client';
import { useState } from 'react';
import { User } from 'lucide-react';

import HeaderPanels, { type Panel } from './HeaderPanels';
import TopClockTimer from '@/components/TopClockTimer';
import { supaBrowser } from '@/lib/supabase-browser';

export default function AppHeader() {
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
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
        <button
          aria-label="Open profile"
          className="h-9 w-9 rounded-full bg-primary/25 text-primary flex items-center justify-center text-xs font-medium hover:bg-primary/35 transition"
          onClick={() => setPanel('profile')}
        >
          <User className="h-5 w-5" />
        </button>
        <button
          aria-label="Open settings"
          className="hidden sm:inline-flex h-9 px-3 rounded-full bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 transition"
          onClick={() => setPanel('settings')}
        >
          Settings
        </button>
        <button
          aria-label="Open billing"
          className="hidden sm:inline-flex h-9 px-3 rounded-full bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 transition"
          onClick={() => handleBilling()}
        >
          Billing
        </button>
      </div>
      <HeaderPanels panel={panel} onOpenChange={(o) => !o && setPanel(null)} />
    </header>
  );
}
