import { Module } from "@nestjs/common";
import { DistrictGovernorController } from "./district-governor.controller";
import { InternationalPresidentController } from "./international-president.controller";
import { RiAdminCleanupController } from "./ri-admin-cleanup.controller";
import { RiDirectorController } from "./ri-director.controller";
import { RiDirectorService } from "./ri-director.service";
import { TrainingAppointmentController } from "./training-appointment.controller";
import { TrainingAppointmentService } from "./training-appointment.service";

/** RI Director portal, International President, District Governors, past-officer cleanup and website training. */
@Module({
  controllers: [RiDirectorController, RiAdminCleanupController, InternationalPresidentController, DistrictGovernorController, TrainingAppointmentController],
  providers: [RiDirectorService, TrainingAppointmentService],
  exports: [RiDirectorService],
})
export class RiDirectorModule {}
