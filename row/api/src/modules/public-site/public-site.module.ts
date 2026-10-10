import { Module } from "@nestjs/common";
import { ClubFinderController } from "./club-finder.controller";
import { ClubGalleryPublicController, ClubWebsitePublicController, PublicProjectController } from "./club-website-tenant.controllers";
import { ClubWebsitePublicDataController } from "./club-website-public-data.controller";
import { ClubWebsitePublicDataV2Controller } from "./club-website-public-data-v2.controller";
import { DistrictWebsitePublicDataController } from "./district-website-public-data.controller";
import { DistrictWebsitesController } from "./district-websites.controller";
import { PublicDirectoryController } from "./public-directory.controller";
import { PublicProjectShareController } from "./public-project-share.controller";
import { PublicProjectStatsController } from "./public-project-stats.controller";
import { ClubWebsiteThemeController, PublicWebsiteDirectoryController } from "./website-directory.controllers";

/** Group 7: the public club / district website feeds, the public project pages and stats, Club Finder and the directory form. */
@Module({
  controllers: [
    ClubWebsitePublicDataController, ClubWebsitePublicDataV2Controller, ClubGalleryPublicController, ClubWebsitePublicController, PublicProjectShareController, PublicProjectController,
    PublicProjectStatsController, PublicWebsiteDirectoryController, ClubWebsiteThemeController, DistrictWebsitePublicDataController, DistrictWebsitesController, ClubFinderController,
    PublicDirectoryController,
  ],
})
export class PublicSiteModule {}
