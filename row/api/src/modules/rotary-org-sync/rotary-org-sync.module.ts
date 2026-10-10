import { Module } from "@nestjs/common";
import { ClubCacheRefreshService, ClubSyncService } from "../../services/rotary-org/rotary-org-sync.services";
import { ClubsModule } from "../clubs/clubs.module";
import { RotaryOrgManualSyncController } from "./rotary-org-manual-sync.controller";
import { ClubRotaryOrgCredentialsController, RotaryOrgProjectSyncController, RotaryOrgProjectSyncLogController, RotaryOrgSyncController } from "./rotary-org-sync.controllers";

/** Group 5: Rotary.org sync (manual club / member sync, bootstrap, the /clubs cache scheduler, project publishing, club credentials). */
@Module({
  imports: [ClubsModule],
  controllers: [RotaryOrgManualSyncController, RotaryOrgSyncController, RotaryOrgProjectSyncController, RotaryOrgProjectSyncLogController, ClubRotaryOrgCredentialsController],
  providers: [ClubCacheRefreshService, ClubSyncService],
})
export class RotaryOrgSyncModule {}
