import AgDashboardLayoutClient from "./AgDashboardLayoutClient";

export default function AgDashboardLayout({ children }: { children: React.ReactNode }) {
  return <AgDashboardLayoutClient>{children}</AgDashboardLayoutClient>;
}
