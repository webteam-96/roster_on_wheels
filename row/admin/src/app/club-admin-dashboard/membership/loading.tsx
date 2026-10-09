import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

export default function MembershipLoading() {
  // Membership: KPIs + monthly-growth chart + member table + recent joiners.
  return <DashboardTabSkeleton kpiCount={4} tableCount={2} showChart />;
}
