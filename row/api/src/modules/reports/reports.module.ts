import { Module } from "@nestjs/common";
import { MonthlyReportsModule } from "../monthly-reports/monthly-reports.module";
import { PphCampsModule } from "../pph-camps/pph-camps.module";
import { ReportsController } from "./reports.controller";
import { DailyStatsReportController } from "./daily-stats-report.controller";
import { DailyStatsReportService } from "./daily-stats-report.service";
import { ClubReportController, MobileClubAdminReportController } from "./club-report.controller";
import { ClubReportService } from "./club-report.service";
import { DistrictReportController, MobileDistrictAdminReportController } from "./district-report.controller";
import { DistrictReportService } from "./district-report.service";
import { DistrictPerformanceReportController } from "./district-performance-report.controller";
import { DistrictPerformanceReportService } from "./district-performance-report.service";
import { GoalSettingModule } from "../goal-setting/goal-setting.module";

/** Report screens and scheduled report emails. */
@Module({
  imports: [MonthlyReportsModule, PphCampsModule, GoalSettingModule],
  controllers: [ReportsController, DailyStatsReportController, ClubReportController, MobileClubAdminReportController, DistrictReportController, MobileDistrictAdminReportController, DistrictPerformanceReportController],
  providers: [DailyStatsReportService, ClubReportService, DistrictReportService, DistrictPerformanceReportService],
})
export class ReportsModule {}
