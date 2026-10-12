import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

export default function ServiceProjectsLoading() {
  // Service Projects overview: 5 KPI tiles + avenue summary table + pending items.
  return <DashboardTabSkeleton kpiCount={4} tableCount={2} />;
}
