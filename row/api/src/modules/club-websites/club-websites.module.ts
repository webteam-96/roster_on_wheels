import { Module } from "@nestjs/common";
import { ClubWebsiteStatusController, ClubWebsitesController } from "./club-websites.controller";

/** Club website records and their Plesk provisioning (SuperAdmin), plus the club dashboard's website status. */
@Module({ controllers: [ClubWebsiteStatusController, ClubWebsitesController] })
export class ClubWebsitesModule {}
