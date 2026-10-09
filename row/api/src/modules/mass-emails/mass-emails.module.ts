import { Module } from "@nestjs/common";
import { ClubMassEmailsController } from "./club-mass-emails.controller";
import { MassEmailService } from "./mass-email.service";

@Module({ controllers: [ClubMassEmailsController], providers: [MassEmailService], exports: [MassEmailService] })
export class MassEmailsModule {}
