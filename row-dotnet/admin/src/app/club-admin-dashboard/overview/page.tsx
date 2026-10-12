import { redirect } from "next/navigation";

export default function LegacyOverviewRedirect() {
  redirect("/club-admin-dashboard/dashboard/overview");
}
