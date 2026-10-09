import { Module } from "@nestjs/common";
import { DashboardResolverController } from "./dashboard-resolver.controller";
import { ClubAdminDashboardController } from "./club-admin-dashboard.controller";
import { ClubAdminDashboardService } from "./club-admin-dashboard.service";
import { DistrictAdminClubGoalsController, DistrictAdminDashboardController } from "./district-admin-dashboard.controller";
import { DistrictAdminDashboardService } from "./district-admin-dashboard.service";
import { AgDashboardController } from "./ag-dashboard.controller";
import { AgDashboardService } from "./ag-dashboard.service";
import { AgReportsController } from "./ag-reports.controller";

/** Dashboard landing and switcher, and the role dashboards. */
@Module({
  controllers: [DashboardResolverController, ClubAdminDashboardController, DistrictAdminDashboardController, DistrictAdminClubGoalsController, AgDashboardController, AgReportsController],
  providers: [ClubAdminDashboardService, DistrictAdminDashboardService, AgDashboardService],
  exports: [ClubAdminDashboardService, DistrictAdminDashboardService, AgDashboardService],
})
export class DashboardsModule {}
