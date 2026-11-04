import type { Metadata } from "next";
import { SitePage } from "@/site/SitePage";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "About the club" };

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <SitePage page="About" load={(shell) => loaders.About(shell, searchParams)} />;
}
