import type { Metadata } from "next";
import { ComingSoon } from "@/components/site/ComingSoon";

export const metadata: Metadata = {
  title: "Tutorial | ROW",
  description: "Tutorials and guides for the ROW platform — coming soon.",
};

export default function TutorialPage() {
  return (
    <ComingSoon
      title="Tutorial"
      message="Step-by-step tutorials and guides are on their way. We're putting them together — please check back soon."
      hideLinks
    />
  );
}
