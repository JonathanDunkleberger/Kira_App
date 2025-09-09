import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';
import { Inter } from 'next/font/google';

import { ThemeProvider } from '../components/theme-provider';
import AppHeader from '../components/AppHeader';
import '../lib/bootlog'; // boot health logging
import LimitBanner from '../components/LimitBanner';

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kira — AI Media Companion', description: 'Talk, don’t alt-tab.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <ClerkProvider>
        <body
          className={`min-h-screen bg-background text-foreground antialiased ${inter.className}`}
        >
          <LimitBanner />
          <ThemeProvider>
            <AppHeader />
            <div className="relative z-0">{children}</div>
          </ThemeProvider>
        </body>
      </ClerkProvider>
    </html>
  );
}
