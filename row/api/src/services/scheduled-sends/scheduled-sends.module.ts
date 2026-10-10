import { Module } from "@nestjs/common";
import { RiDirectorModule } from "../../modules/ri-director/ri-director.module";
import { EmailScheduledSendService } from "./email-scheduled-send.service";

/** The scheduled communication senders (RI items deduct from the RI Director's credits). */
@Module({ imports: [RiDirectorModule], providers: [EmailScheduledSendService] })
export class ScheduledSendsModule {}
