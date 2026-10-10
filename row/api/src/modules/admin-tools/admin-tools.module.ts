import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ClubsModule } from "../clubs/clubs.module";
import { CitationMatrixController, FindRotarianController } from "./citation-and-find.controllers";
import { ProjectClassificationController } from "./project-classification.controller";
import { DistrictAwardsConfigController } from "./district-awards-config.controller";
import { EmailLogController } from "./email-log.controller";
import { ClubAnalyticsController } from "./club-analytics.controller";
import { SuperAdminsController } from "./super-admins.controller";
import { GlobalMemberSearchController } from "./global-member-search.controller";
import { WhatsAppLogController } from "./whatsapp-log.controller";
import { DistrictDirectoryController } from "./district-directory.controller";
import { DirectoryConfigController } from "./directory-config.controller";
import { MemberDuplicatesController } from "./member-duplicates.controller";
import { GlobalSearchController, PushLogsController } from "./search-and-push.controllers";
import { ClubMemberHonoraryController, MassEmailMediaController, WebSsoController, WhatsAppInfoController } from "./small-tools.controllers";

/** SuperAdmin tools and small shared endpoints (group 8 of the port). */
@Module({
  imports: [AuthModule, ClubsModule],
  controllers: [MassEmailMediaController, WhatsAppInfoController, ClubMemberHonoraryController, WebSsoController, GlobalSearchController, PushLogsController, CitationMatrixController, FindRotarianController, ProjectClassificationController, DistrictAwardsConfigController, EmailLogController, ClubAnalyticsController, SuperAdminsController, GlobalMemberSearchController, WhatsAppLogController, DistrictDirectoryController, DirectoryConfigController, MemberDuplicatesController],
})
export class AdminToolsModule {}
