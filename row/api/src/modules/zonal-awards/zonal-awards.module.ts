import { Module } from "@nestjs/common";
import { ZonalAwardsController } from "./zonal-awards.controller";
import { ZonalAwardsAutoCalculationService, ZonalAwardsAutoCalculationWorker } from "./zonal-awards-auto-calc.service";

/** The zones' district awards (questions, district entries, Foundation import, reports). */
@Module({ controllers: [ZonalAwardsController], providers: [ZonalAwardsAutoCalculationService, ZonalAwardsAutoCalculationWorker], exports: [ZonalAwardsAutoCalculationService] })
export class ZonalAwardsModule {}
