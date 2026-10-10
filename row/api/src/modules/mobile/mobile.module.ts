import { Module } from "@nestjs/common";
import { ClubGroupsModule } from "../club-groups/club-groups.module";
import { RiDirectorModule } from "../ri-director/ri-director.module";
import { MobileCalendarController } from "./mobile-calendar.controller";
import { MobileDistrictAwardsController } from "./mobile-district-awards.controller";
import { MobileFcmController } from "./mobile-fcm.controller";
import { MobileLoginCheckController } from "./mobile-login-check.controller";
import { MobileMemberSettingsController } from "./mobile-member-settings.controller";
import { MobileNotificationFeedService } from "./mobile-notification-feed.service";
import { MobileNotificationsController } from "./mobile-notifications.controller";
import { MobileVersionController } from "./mobile-version.controller";
import { MobileWeblinksController } from "./mobile-weblinks.controller";
import { RouteMaintenanceController } from "./route-maintenance.controller";

/** App-only endpoints (the mobile twins of web controllers live with their web modules). */
@Module({
  imports: [ClubGroupsModule, RiDirectorModule],
  controllers: [MobileVersionController, MobileDistrictAwardsController, MobileCalendarController, MobileWeblinksController, MobileMemberSettingsController, MobileFcmController, MobileNotificationsController, MobileLoginCheckController, RouteMaintenanceController],
  providers: [MobileNotificationFeedService],
})
export class MobileModule {}
