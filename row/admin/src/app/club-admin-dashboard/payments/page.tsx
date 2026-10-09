import { redirect } from "next/navigation";

export default function LegacyPaymentsRedirect() {
  redirect("/club-admin-dashboard/membership-dues");
}
