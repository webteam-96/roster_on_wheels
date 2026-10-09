import type { Metadata } from "next";
import { DistrictGovernors } from "@/components/pages/district-governors/DistrictGovernors";

export const metadata: Metadata = {
  title: "District Governors | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Meet the 2026-27 District Governors leading Rotary across Zones 4, 5, 6, 7 & 8 — direct phone and email contacts for all 43 districts.",
};

export default function DistrictGovernorsPage() {
  return <DistrictGovernors />;
}
