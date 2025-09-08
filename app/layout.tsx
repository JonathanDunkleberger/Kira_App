import './globals.css';
import { Suspense } from 'react';

import Header from '@/components/Header';
import TimerPill from '@/components/TimerPill';
import EntitlementsHydrator from '@/components/EntitlementsHydrator';
import Banner from '@/components/Banner';
import Sidebar from '@/components/Sidebar'; // <-- Add this import
import ConversationProvider from '@/lib/state/ConversationProvider';
import UpgradeSnackbarPortal from '@/components/UpgradeSnackbarPortal';

export const metadata = { title: 'Kira — AI Media Companion', description: 'Talk, don’t alt-tab.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0b0b12] text-white font-ui antialiased">
        <ConversationProvider>
          <Banner />
          {/* Global upgrade nudge */}
          <UpgradeSnackbarPortal />
          <div className="flex">
            <Suspense fallback={null}>
              <Sidebar />
            </Suspense>
            <div className="flex-1 flex flex-col">
              {/* Header moved inside provider scope */}
              <Header />
              <EntitlementsHydrator />
              <TimerPill />
              <div className="flex-1 min-w-0">{children}</div>
            </div>
          </div>
        </ConversationProvider>
  {/* Persistent TTS audio element for single-blob playback */}
  <audio id="tts-player" style={{ display: 'none' }} />
      </body>
    </html>
  );
}
