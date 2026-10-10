import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service";
import { YearTableResolver } from "./year-table.resolver";
import { AuditLogService } from "./audit-log.service";
import { DcAutoGroupService } from "./dc-auto-group.service";
import { SmsSender, WhatsAppSender } from "./messaging";
import { BodSubGroupAutoService } from "./bod-sub-group-auto.service";
import { ClubSiteCachePurger } from "./club-site-cache-purger";
import { CreditManagementService } from "./credit-management.service";
import { CitationAutoPointsService } from "./citation-auto-points.service";
import { RotaryYearRolloverService } from "./rotary-year-rollover.service";
import { CreditExpiryService } from "./credit-expiry.service";
import { ClubWebsiteReminderService } from "./club-website-reminder.service";
import { FirebasePushService } from "./push/firebase-push.service";
import { PushWorkersService } from "./push/push-workers.service";
import { CitationRecalcTrigger } from "./citation-recalc.trigger";
import { CurrencyRateService } from "./currency-rate.service";
import { ZoomMeetingService } from "./zoom-meeting.service";
import { PleskService } from "./plesk.service";
import { ProjectCountRules } from "./project-count-rules";
import { RotaryOrgApiClient } from "./rotary-org/rotary-org-api.client";
import { DistrictRotaryRefreshJobRunner } from "./rotary-org/rotary-org-sync.services";
import { ClubWebsiteActivationService } from "./club-website-activation.service";
import { IisAppPoolRecycler } from "./iis-app-pool-recycler";

/** Services used across modules (the shared registrations of Program.cs). */
@Global()
@Module({
  providers: [EmailService, YearTableResolver, AuditLogService, DcAutoGroupService, SmsSender, WhatsAppSender, BodSubGroupAutoService, ClubSiteCachePurger, CreditManagementService, CitationRecalcTrigger, CitationAutoPointsService, CurrencyRateService, PleskService, ProjectCountRules, ClubWebsiteActivationService, IisAppPoolRecycler, RotaryOrgApiClient, ZoomMeetingService, DistrictRotaryRefreshJobRunner, RotaryYearRolloverService, CreditExpiryService, ClubWebsiteReminderService, FirebasePushService, PushWorkersService],
  exports: [EmailService, YearTableResolver, AuditLogService, DcAutoGroupService, SmsSender, WhatsAppSender, BodSubGroupAutoService, ClubSiteCachePurger, CreditManagementService, CitationRecalcTrigger, CitationAutoPointsService, CurrencyRateService, PleskService, ProjectCountRules, ClubWebsiteActivationService, IisAppPoolRecycler, RotaryOrgApiClient, ZoomMeetingService, DistrictRotaryRefreshJobRunner, FirebasePushService],
})
export class SharedModule {}
