import { Module } from "@nestjs/common";
import { MobileClubAdminPastPresidentsController } from "./mobile-past-presidents.controller";
import { BoardOfDirectorsController } from "./board-of-directors.controller";
import { PastPresidentsController } from "./past-presidents.controller";
import { DesignationService } from "./designation.service";
import { BoardDirectorService } from "./board-director.service";
import { PastPresidentService } from "./past-president.service";

/** Board of directors, designations and past presidents. */
@Module({
  controllers: [BoardOfDirectorsController, PastPresidentsController, MobileClubAdminPastPresidentsController],
  providers: [DesignationService, BoardDirectorService, PastPresidentService],
  exports: [DesignationService, BoardDirectorService, PastPresidentService],
})
export class BoardModule {}
