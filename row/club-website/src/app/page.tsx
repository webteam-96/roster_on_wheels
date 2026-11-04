import { SitePage } from "@/site/SitePage";
import { loadHome } from "@/themes/shared/loaders";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <SitePage page="Home" load={loadHome} />;
}
