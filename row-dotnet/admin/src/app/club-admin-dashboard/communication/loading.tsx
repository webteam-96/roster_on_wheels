import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

export default function CommunicationLoading() {
  // Communication: 3 KPIs + announcements / newsletters / events lists.
  return <DashboardTabSkeleton kpiCount={3} tableCount={3} />;
}
