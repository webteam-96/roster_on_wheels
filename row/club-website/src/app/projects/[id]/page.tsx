import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SitePage } from "@/site/SitePage";
import { projectMetadata } from "@/site/projectMeta";
import { loaders } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";

// The API's share links point here (/projects/<id>); it shows the same page as /project?pid=<id>.
interface Props { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  return projectMetadata(params.id);
}

export default async function Page(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (!/^\d+$/.test(params.id)) redirect("/");
  return <SitePage page="ProjectDetail" load={(shell) => loaders.ProjectDetail(shell, { ...searchParams, pid: params.id })} />;
}
