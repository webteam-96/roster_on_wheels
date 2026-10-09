import { Suspense } from "react";
import ClubAdminDashboardLayoutClient from "./ClubAdminDashboardLayoutClient";
import NavigationProgress from "@/components/NavigationProgress";
import WebsiteProvisioningToast from "@/components/wallet/WebsiteProvisioningToast";

export default function ClubAdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Top progress bar — uses useSearchParams() internally so it must be
          wrapped in Suspense in the Next 14 app router. */}
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <ClubAdminDashboardLayoutClient>{children}</ClubAdminDashboardLayoutClient>
      {/* Global top-right card that tracks background club-website provisioning. */}
      <WebsiteProvisioningToast />
    </>
  );
}
