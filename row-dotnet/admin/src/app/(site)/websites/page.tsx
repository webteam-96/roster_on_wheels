import type { Metadata } from "next";
import { Websites } from "@/components/pages/websites/Websites";

export const metadata: Metadata = {
  title: "District & Club Websites | ROW",
  description:
    "Explore District and Club websites across ROW — search by district, state or city.",
};

export default function WebsitesPage() {
  return <Websites />;
}
