import { Module } from "@nestjs/common";
import { LiveDocumentsExportController, OcvGovController, PublicOcvLiveDocumentsController } from "./ocv-gov.controller";
import { OcvGovService } from "./ocv-gov.service";

@Module({
  controllers: [OcvGovController, PublicOcvLiveDocumentsController, LiveDocumentsExportController],
  providers: [OcvGovService],
})
export class OcvGovModule {}
