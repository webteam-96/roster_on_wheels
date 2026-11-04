import type { Metadata } from "next";
import { buildShell } from "@/lib/pageShell";
import { SiteNotFound } from "@/components/SiteNotFound";
import { ThemedShell } from "@/site/SitePage";

export const metadata: Metadata = { title: "Page not found" };

export default async function NotFound() {
  const shell = await buildShell();
  if (!shell) return <SiteNotFound host="" />;
  return (
    <ThemedShell shell={shell}>
      <div className="container-x py-24 text-center">
        <h1 className="font-heading text-3xl font-extrabold text-navy">Page not found</h1>
        <p className="mt-3 text-ink/70">This page doesn&apos;t exist, or it has moved.</p>
        <a href="/" className="btn-navy mt-6 inline-flex !rounded-full">Back to the home page</a>
      </div>
    </ThemedShell>
  );
}
