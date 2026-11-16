import type { Metadata } from "next";
import { getServerBrand } from "@/lib/brand";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { Suspense } from "react";
import "./layers.css"; // first: fixes the cascade-layer order
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import ClientProviders from "@/components/ClientProviders";
import RootShell from "@/components/RootShell";
import PasteLimitGuard from "@/components/PasteLimitGuard";
import NetworkStatusBanner from "@/components/NetworkStatusBanner";
import NavigationLoader from "@/components/NavigationLoader";

// design.md §2: Figtree body, Bricolage Grotesque display. Tailwind's font-sans / font-display read these vars.
const body = Figtree({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz"], variable: "--font-display", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand();
  return {
    title: `${brand.productName} - Member Management`,
    description: `${brand.productName} Member Management System`,
    ...(brand.faviconUrl ? { icons: { icon: brand.faviconUrl, shortcut: brand.faviconUrl } } : {}),
    ...(brand.openGraphImageUrl ? { openGraph: { images: [brand.openGraphImageUrl] } } : {}),
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning on <html>: the "ROW-add-to-org-ext" browser extension injects
  // data-add-to-org-ext on <html> before hydration (see lib/addToOrg.ts). This silences the
  // harmless "Extra attributes from the server" warning; scope is the <html> element only.
  return (
    // data-theme="light": the admin is light-only; without it Astryx sets color-scheme "light dark" and an
    // OS in dark mode paints inputs that have no background of their own dark grey.
    <html lang="en" data-theme="light" className={`${body.variable} ${display.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
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
