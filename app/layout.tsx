import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import AppHeader from '@/components/app/AppHeader';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kira — AI Media Companion', description: 'Talk, don’t alt-tab.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <AppHeader />
          <div className="relative z-0">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
