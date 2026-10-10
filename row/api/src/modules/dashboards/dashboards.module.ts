import { Module } from "@nestjs/common";
import { DashboardResolverController } from "./dashboard-resolver.controller";
import { ClubAdminDashboardController, MobileClubAdminDashboardController } from "./club-admin-dashboard.controller";
import { ClubAdminDashboardService } from "./club-admin-dashboard.service";
import { DistrictAdminClubGoalsController, DistrictAdminDashboardController, MobileDistrictAdminClubGoalsController, MobileDistrictAdminDashboardController } from "./district-admin-dashboard.controller";
import { DistrictAdminDashboardService } from "./district-admin-dashboard.service";
import { AgDashboardController, MobileAgDashboardController } from "./ag-dashboard.controller";
import { AgDashboardService } from "./ag-dashboard.service";
import { AgReportsController } from "./ag-reports.controller";

/** Dashboard landing and switcher, and the role dashboards. */
@Module({
  controllers: [DashboardResolverController, ClubAdminDashboardController, DistrictAdminDashboardController, DistrictAdminClubGoalsController, AgDashboardController, AgReportsController, MobileClubAdminDashboardController, MobileDistrictAdminDashboardController, MobileDistrictAdminClubGoalsController, MobileAgDashboardController],
  providers: [ClubAdminDashboardService, DistrictAdminDashboardService, AgDashboardService],
  exports: [ClubAdminDashboardService, DistrictAdminDashboardService, AgDashboardService],
})
export class DashboardsModule {}
