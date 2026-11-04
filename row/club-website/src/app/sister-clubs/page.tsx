import type { Metadata } from "next";
import { SitePage } from "@/site/SitePage";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sister clubs" };

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <SitePage page="SisterClubs" load={(shell) => loaders.SisterClubs(shell, searchParams)} />;
}
