import type { Metadata } from "next";
import { SitePage } from "@/site/SitePage";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meetings" };

export default async function Page(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  return <SitePage page="Meetings" load={(shell) => loaders.Meetings(shell, searchParams)} />;
}
