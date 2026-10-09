import { Module } from "@nestjs/common";
import { MonthlyReportsController, TrfContributionsController } from "./monthly-reports.controller";
import { MonthlyReportService } from "./monthly-report.service";
import { CmrSubmissionMailer } from "./cmr-submission.mailer";
import { DistrictCmrEmailSettingsController, DistrictCmrEmailSettingsService } from "./cmr-email-settings";

/** Club Monthly Reports (with their Word / PDF documents), TRF contributions and the district's CMR email settings. */
@Module({
  controllers: [MonthlyReportsController, TrfContributionsController, DistrictCmrEmailSettingsController],
  providers: [MonthlyReportService, CmrSubmissionMailer, DistrictCmrEmailSettingsService],
  exports: [MonthlyReportService, DistrictCmrEmailSettingsService],
})
export class MonthlyReportsModule {}
