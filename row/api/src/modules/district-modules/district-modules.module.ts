import { Module } from "@nestjs/common";
import { DistrictContentController } from "./district-content.controller";
import { DistrictProjectsController } from "./district-projects.controller";
import { DistrictWebsiteDataController } from "./district-website-data.controller";
import { DistrictPeopleController } from "./district-people.controller";
import { DistrictCommitteeController } from "./district-committee.controller";
import { DistrictCitationController } from "./district-citation.controller";
import { ContentModule } from "../content/content.module";
import { MastersModule } from "../masters/masters.module";
import { ClubGroupsModule } from "../club-groups/club-groups.module";
import { MassEmailsModule } from "../mass-emails/mass-emails.module";
import { RolesModule } from "../roles/roles.module";

/** Port of DistrictModulesController.cs, split by area. */
@Module({
  imports: [ContentModule, MastersModule, ClubGroupsModule, MassEmailsModule, RolesModule],
  controllers: [DistrictContentController, DistrictProjectsController, DistrictWebsiteDataController, DistrictPeopleController, DistrictCommitteeController, DistrictCitationController],
})
export class DistrictModulesModule {}
