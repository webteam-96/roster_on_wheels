import type { Metadata } from "next";
import { SitePage } from "@/site/SitePage";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Youth partners" };

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <SitePage page="YouthPartners" load={(shell) => loaders.YouthPartners(shell, searchParams)} />;
}
