import { Module } from "@nestjs/common";
import { DistrictsController } from "./districts.controller";
import { DistrictService } from "./districts.service";

@Module({ controllers: [DistrictsController], providers: [DistrictService], exports: [DistrictService] })
export class DistrictsModule {}
