import type { Metadata } from "next";
import { DownloadApp } from "@/components/pages/download/DownloadApp";
import { SiteFooter } from "@/components/site/SiteFooter";

export const metadata: Metadata = {
  title: "Download App | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Download the official Rotary Zones 4, 5, 6, 7 & 8 mobile app — the club and district directory, member search, events and announcements, on Android and iOS.",
};

export default function DownloadPage() {
  return (
    <>
      <DownloadApp />
      <SiteFooter />
    </>
  );
}
