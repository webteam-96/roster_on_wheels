import type { Metadata } from "next";
import { SitePage } from "@/site/SitePage";
import { projectMetadata } from "@/site/projectMeta";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";
type Props = { searchParams: Record<string, string | string[] | undefined> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const searchParams = await props.searchParams;
  return projectMetadata(typeof searchParams.pid === "string" ? searchParams.pid : undefined);
}

export default async function Page(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  return <SitePage page="ProjectDetail" load={(shell) => loaders.ProjectDetail(shell, searchParams)} />;
}
