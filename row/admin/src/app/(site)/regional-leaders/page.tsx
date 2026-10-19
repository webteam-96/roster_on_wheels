import type { Metadata } from "next";
import { RegionalLeaders } from "@/components/pages/regional-leaders/RegionalLeaders";

export const metadata: Metadata = {
  title: "Regional Leaders | ROW",
  description:
    "Directory of Rotary's regional leaders across the zones: Action Plan Champions, Foundation, Membership, Public Image, E/MGA, EPNC and Polio plan leads with direct phone and email contacts.",
};

export default function RegionalLeadersPage() {
  return <RegionalLeaders />;
}
