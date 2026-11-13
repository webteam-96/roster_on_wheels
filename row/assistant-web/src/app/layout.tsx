import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

// next/font self-hosts the font files under /_next/static, so the CSP needs no Google origins.
const body = Figtree({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "ROW Assistant",
  description: "Ask questions about your Rotary club, district and zone data.",
  icons: { icon: "/rotary-logo.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0B2A5E",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={body.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
