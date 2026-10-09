import type { Type } from "@nestjs/common";
import { SharedModule } from "../services/shared.module";
import { AuthModule } from "./auth/auth.module";
import { ReferenceModule } from "./reference/reference.module";
import { ZonesModule } from "./zones/zones.module";
import { DistrictsModule } from "./districts/districts.module";
import { ClubsModule } from "./clubs/clubs.module";
import { MobileAuthModule } from "./mobile-auth/mobile-auth.module";
import { MembersModule } from "./members/members.module";
import { ModulesModule } from "./modules/modules.module";
import { RolesModule } from "./roles/roles.module";
import { BoardModule } from "./board/board.module";
import { CreditsModule } from "./credits/credits.module";
import { ContentModule } from "./content/content.module";
import { MastersModule } from "./masters/masters.module";
import { ClubGroupsModule } from "./club-groups/club-groups.module";
import { WebsiteDataModule } from "./website-data/website-data.module";
import { DashboardsModule } from "./dashboards/dashboards.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { MassEmailsModule } from "./mass-emails/mass-emails.module";
import { DistrictModulesModule } from "./district-modules/district-modules.module";
import { PphCampsModule } from "./pph-camps/pph-camps.module";
import { ZonalAwardsModule } from "./zonal-awards/zonal-awards.module";
import { ProjectsModule } from "./projects/projects.module";
import { MonthlyReportsModule } from "./monthly-reports/monthly-reports.module";
import { ClubLeadershipModule } from "./club-leadership/club-leadership.controller";
import { ClubWebsitesModule } from "./club-websites/club-websites.module";

/**
 * Every ported feature module, registered with the application. Add a module
 * here when its controllers are ported (see PORTING.md for the order).
 */
export const FEATURE_MODULES: Type[] = [SharedModule, AuthModule, ReferenceModule, ZonesModule, DistrictsModule, ClubsModule, MobileAuthModule, MembersModule, ModulesModule, RolesModule, BoardModule, CreditsModule, ContentModule, MastersModule, ClubGroupsModule, WebsiteDataModule, DashboardsModule, ApprovalsModule, MassEmailsModule, DistrictModulesModule, PphCampsModule, ZonalAwardsModule, ProjectsModule, MonthlyReportsModule, ClubLeadershipModule, ClubWebsitesModule];
