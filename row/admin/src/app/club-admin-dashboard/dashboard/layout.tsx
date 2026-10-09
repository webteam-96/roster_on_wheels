import DashboardTabs from "./dashboardTabs";

export default function DashboardSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <DashboardTabs />
      {children}
    </div>
  );
}
