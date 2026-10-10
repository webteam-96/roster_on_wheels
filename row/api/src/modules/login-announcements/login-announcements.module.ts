import { Module } from "@nestjs/common";
import { LoginAnnouncementController, MobileLoginAnnouncementController } from "./login-announcements.controller";

@Module({ controllers: [LoginAnnouncementController, MobileLoginAnnouncementController] })
export class LoginAnnouncementsModule {}
