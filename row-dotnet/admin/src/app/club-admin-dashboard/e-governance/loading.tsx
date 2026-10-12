import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

export default function EGovernanceLoading() {
  // E-Governance: KPIs + CMR table + recent meetings table.
  return <DashboardTabSkeleton kpiCount={4} tableCount={2} />;
}
