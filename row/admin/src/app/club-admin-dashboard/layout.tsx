import ClubAdminDashboardLayoutClient from "./ClubAdminDashboardLayoutClient";
import WebsiteProvisioningToast from "@/components/wallet/WebsiteProvisioningToast";

export default function ClubAdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClubAdminDashboardLayoutClient>
      {children}
      {/* Top-right card that tracks club-website provisioning; inside the role check so other roles never call it. */}
      <WebsiteProvisioningToast />
    </ClubAdminDashboardLayoutClient>
  );
}
