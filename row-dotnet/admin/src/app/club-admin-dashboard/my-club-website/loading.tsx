import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

export default function MyClubWebsiteLoading() {
  // Website: 4 status KPIs + 1 details/section block.
  return <DashboardTabSkeleton kpiCount={4} tableCount={1} />;
}
