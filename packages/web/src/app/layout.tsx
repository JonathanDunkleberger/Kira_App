import type { Metadata } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Kira",
  description: "Not an assistant. A presence.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/kira-favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <link
            href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&family=Playfair+Display:wght@400;500&display=swap"
            rel="stylesheet"
          />
          {/* Preload Live2D model assets — start downloading before React mounts */}
          <link rel="preload" href="/worklets/models/Kira/kira.model3.json" as="fetch" crossOrigin="anonymous" />
          <link rel="preload" href="/worklets/models/Kira/kira.moc3" as="fetch" crossOrigin="anonymous" />

        </head>
        <body style={{ background: "#0D1117", color: "#C9D1D9", margin: 0 }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
