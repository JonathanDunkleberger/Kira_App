import './globals.css';
import Image from 'next/image';

export const metadata = { title: 'Kira — AI Media Companion', description: 'Talk, don’t alt-tab.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink font-ui antialiased">
    <header className="container-page flex items-center justify-between pb-2">
          <div className="flex items-center gap-3">
      <Image src="/logo.png" alt="Kira" width={28} height={28} priority />
            <span className="subtle text-xs">beta</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
