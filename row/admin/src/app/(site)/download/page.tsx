import type { Metadata } from "next";
import { DownloadApp } from "@/components/pages/download/DownloadApp";
import { SiteFooter } from "@/components/site/SiteFooter";

export const metadata: Metadata = {
  title: "Download App | ROW",
  description:
    "Download the official ROW mobile app: the club and district directory, member search, events and announcements, on Android and iOS.",
};

export default function DownloadPage() {
  return (
    <>
      <DownloadApp />
      <SiteFooter />
    </>
  );
}
