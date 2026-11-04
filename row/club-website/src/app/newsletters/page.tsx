import type { Metadata } from "next";
import { SitePage } from "@/site/SitePage";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Newsletters" };

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <SitePage page="Newsletters" load={(shell) => loaders.Newsletters(shell, searchParams)} />;
}
