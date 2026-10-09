import { Module } from "@nestjs/common";
import { DistrictPphCampsController, PphCampsController } from "./pph-camps.controller";
import { PphCampService } from "./pph-camp.service";

/** PPH (health check-up) camps: club and district camps, attendees and readings. */
@Module({ controllers: [PphCampsController, DistrictPphCampsController], providers: [PphCampService], exports: [PphCampService] })
export class PphCampsModule {}
