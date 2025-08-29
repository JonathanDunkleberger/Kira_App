import './globals.css';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Banner from '@/components/Banner';
import ProfileProvider from '@/components/ProfileProvider';

export const metadata = { title: 'Kira — AI Media Companion', description: 'Talk, don’t alt-tab.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0b0b12] text-white font-ui antialiased">
        <Banner />
        <Header />
        <div className="flex gap-0">
          <Sidebar />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </body>
    </html>
  );
}
