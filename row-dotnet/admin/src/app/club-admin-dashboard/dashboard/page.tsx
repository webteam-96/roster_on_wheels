import { redirect } from "next/navigation";

export default function DashboardIndex() {
  redirect("/club-admin-dashboard/dashboard/overview");
}
