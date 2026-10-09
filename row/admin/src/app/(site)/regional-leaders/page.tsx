import type { Metadata } from "next";
import { RegionalLeaders } from "@/components/pages/regional-leaders/RegionalLeaders";

export const metadata: Metadata = {
  title: "Regional Leaders | Rotary Zones 4, 5, 6 & 7",
  description:
    "Directory of Rotary's regional leaders across Zones 4, 5, 6 and 7 — Action Plan Champions, Foundation, Membership, Public Image, E/MGA, EPNC and Polio plan leads with direct phone and email contacts.",
};

export default function RegionalLeadersPage() {
  return <RegionalLeaders />;
}
