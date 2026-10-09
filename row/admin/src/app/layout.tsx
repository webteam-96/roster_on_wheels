import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import ClientProviders from "@/components/ClientProviders";
import RootShell from "@/components/RootShell";
import PasteLimitGuard from "@/components/PasteLimitGuard";
import NetworkStatusBanner from "@/components/NetworkStatusBanner";
import NavigationLoader from "@/components/NavigationLoader";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Rotary Zones 4, 5, 6, 7 & 8 - Member Management",
  description: "Rotary Zones 4, 5, 6, 7 & 8 Member Management System",
  icons: {
    icon: "/images/rotary-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning on <html>: the "rizones-add-to-org-ext" browser extension injects
  // data-add-to-org-ext on <html> before hydration (see lib/addToOrg.ts). This silences the
  // harmless "Extra attributes from the server" warning; scope is the <html> element only.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/images/rotary-logo.png" type="image/png" />
        <link rel="shortcut icon" href="/images/rotary-logo.png" type="image/png" />
      </head>
      <body className={`${inter.className} antialiased`}>
        <ClientProviders>
          <RootShell>{children}</RootShell>
          <PasteLimitGuard />
          <NetworkStatusBanner />
          <Suspense fallback={null}>
            <NavigationLoader />
          </Suspense>
          <Toaster />
        </ClientProviders>
      </body>
    </html>
  );
}
