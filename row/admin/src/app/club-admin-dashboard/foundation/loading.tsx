import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

export default function FoundationLoading() {
  // Foundation: 4 KPIs, fund-split chart, goals table.
  return <DashboardTabSkeleton kpiCount={4} tableCount={1} showChart />;
}
