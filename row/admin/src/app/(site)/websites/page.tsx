import type { Metadata } from "next";
import { Websites } from "@/components/pages/websites/Websites";

export const metadata: Metadata = {
  title: "District & Club Websites | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Explore District and Club websites across Rotary Zones 4, 5, 6, 7 & 8 — search by district, state or city.",
};

export default function WebsitesPage() {
  return <Websites />;
}
