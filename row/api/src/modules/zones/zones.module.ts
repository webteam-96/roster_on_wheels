import { Module } from "@nestjs/common";
import { ZonesController } from "./zones.controller";
import { ZoneService } from "./zones.service";

@Module({ controllers: [ZonesController], providers: [ZoneService], exports: [ZoneService] })
export class ZonesModule {}
