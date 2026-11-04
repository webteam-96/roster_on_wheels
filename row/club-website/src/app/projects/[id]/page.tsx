import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SitePage } from "@/site/SitePage";
import { projectMetadata } from "@/site/projectMeta";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";

// The API's share links point here (/projects/<id>); it shows the same page as /project?pid=<id>.
interface Props { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return projectMetadata(params.id);
}

export default function Page({ params, searchParams }: Props) {
  if (!/^\d+$/.test(params.id)) redirect("/");
  return <SitePage page="ProjectDetail" load={(shell) => loaders.ProjectDetail(shell, { ...searchParams, pid: params.id })} />;
}
