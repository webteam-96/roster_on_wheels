import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

export default function MembershipDuesLoading() {
  // Dues: 4 KPI tiles + members payment table.
  return <DashboardTabSkeleton kpiCount={4} tableCount={1} />;
}
