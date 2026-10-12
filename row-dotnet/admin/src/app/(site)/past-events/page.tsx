import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/SiteFooter";
import { EventsBanner } from "@/components/pages/past-events/EventsBanner";
import { EventsExplorer } from "@/components/pages/past-events/EventsExplorer";

export const metadata: Metadata = {
  title: "Zonal Events | ROW",
  description:
    "Relive the moments and revisit the milestones from past Rotary zonal events, institutes and leadership conclaves.",
};

export default function PastEventsPage() {
  return (
    <>
      <EventsBanner />
      <EventsExplorer />
      <SiteFooter />
    </>
  );
}
