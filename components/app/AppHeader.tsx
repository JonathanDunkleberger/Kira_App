'use client';
import { useState, useRef, useEffect } from 'react';
import { User, Settings, CreditCard, MessageSquare } from 'lucide-react';

import HeaderPanels, { type Panel } from './HeaderPanels';
import TopClockTimer from '@/components/TopClockTimer';
import { supaBrowser } from '@/lib/supabase-browser';

export default function AppHeader() {
  const [panel, setPanel] = useState<Panel>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

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
    <header className="relative h-14 flex flex-col items-center justify-center bg-transparent">
      <TopClockTimer />
      <div className="mt-0.5 text-[10px] leading-none tracking-wide uppercase text-white/35 select-none">
        by <span className="font-semibold text-white/50">Elsa Research</span>
      </div>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center" ref={menuRef}>
        <button
          aria-label="Open menu"
          className="h-9 w-9 rounded-full bg-primary/25 text-primary flex items-center justify-center hover:bg-primary/35 transition relative"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <User className="h-5 w-5" />
        </button>
        {menuOpen && (
          <div className="absolute top-full mt-2 right-0 w-44 rounded-md bg-background border border-border shadow-lg text-xs py-1 z-[130]">
            <button
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5"
              onClick={() => {
        <button
          type="button"
          data-open-auth
          onClick={() => setPanel('auth')}
          style={{ display: 'none' }}
        />
                setPanel('profile');
                setMenuOpen(false);
              }}
            >
              <User className="h-3.5 w-3.5" /> Profile
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5"
              onClick={() => {
                setPanel('settings');
                setMenuOpen(false);
              }}
            >
              <Settings className="h-3.5 w-3.5" /> Settings
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5"
              onClick={() => {
                handleBilling();
                setMenuOpen(false);
              }}
            >
              <CreditCard className="h-3.5 w-3.5" /> Billing
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5"
              onClick={() => {
                setPanel('feedback');
                setMenuOpen(false);
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Feedback
            </button>
            <div className="border-t border-white/10 my-1" />
            <button
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5"
              onClick={() => {
                setPanel('auth');
                setMenuOpen(false);
              }}
            >
              <span className="inline-block h-3.5 w-3.5 rounded bg-primary/40" /> Sign in / Up
            </button>
          </div>
        )}
      </div>
      <HeaderPanels panel={panel} onOpenChange={(o) => !o && setPanel(null)} />
    </header>
  );
}
