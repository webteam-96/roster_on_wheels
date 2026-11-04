import type { Metadata } from "next";
import { SitePage } from "@/site/SitePage";
import { projectMetadata } from "@/site/projectMeta";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";
type Props = { searchParams: Record<string, string | string[] | undefined> };

export function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return projectMetadata(typeof searchParams.pid === "string" ? searchParams.pid : undefined);
}

export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <SitePage page="ProjectDetail" load={(shell) => loaders.ProjectDetail(shell, searchParams)} />;
}
