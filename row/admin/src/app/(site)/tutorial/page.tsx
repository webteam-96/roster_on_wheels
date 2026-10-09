import type { Metadata } from "next";
import { ComingSoon } from "@/components/site/ComingSoon";

export const metadata: Metadata = {
  title: "Tutorial | Rotary Zones 4, 5, 6, 7 & 8",
  description: "Tutorials and guides for the Rotary Zones 4, 5, 6, 7 & 8 platform — coming soon.",
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
