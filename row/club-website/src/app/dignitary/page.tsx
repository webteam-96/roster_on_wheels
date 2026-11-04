import type { Metadata } from "next";
import { SitePage } from "@/site/SitePage";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Club leadership" };

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <SitePage page="Dignitary" load={(shell) => loaders.Dignitary(shell, searchParams)} />;
}
