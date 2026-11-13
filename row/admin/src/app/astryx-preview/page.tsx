import { notFound } from "next/navigation";
import AstryxPreview from "./AstryxPreview";

// Dev-only page to choose the Astryx theme; never served in production builds.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AstryxPreview />;
}
