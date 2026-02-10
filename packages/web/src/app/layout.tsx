import type { Metadata } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Kira",
  description: "Not an assistant. A presence.",
  icons: {
    icon: [
      { url: "/kira-favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
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
        </head>
        <body style={{ background: "#0D1117", color: "#C9D1D9", margin: 0 }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
