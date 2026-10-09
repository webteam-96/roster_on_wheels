import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

export default function DashboardOverviewLoading() {
  // Overview tab: many KPIs + chart + 2 list blocks (avenues + events).
  return <DashboardTabSkeleton kpiCount={4} tableCount={2} showChart />;
}
