import { redirect } from "next/navigation";

export default function LegacyWebsiteRedirect() {
  redirect("/club-admin-dashboard/my-club-website");
}
