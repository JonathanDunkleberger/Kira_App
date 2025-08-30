import './globals.css';
import Header from '@/components/Header';
import Banner from '@/components/Banner';
import Sidebar from '@/components/Sidebar'; // <-- Add this import
import { Suspense } from 'react';
import ConversationProvider from '@/lib/state/ConversationProvider';

export const metadata = { title: 'Kira — AI Media Companion', description: 'Talk, don’t alt-tab.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0b0b12] text-white font-ui antialiased">
    <Banner />
    <ConversationProvider>
      <div className="flex">
        <Suspense fallback={null}>
          <Sidebar />
        </Suspense>
        <div className="flex-1 flex flex-col">
          <Header />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </ConversationProvider>
      </body>
    </html>
  );
}
