import { Module } from "@nestjs/common";
import { ClubsController } from "./clubs.controller";
import { ClubService } from "./clubs.service";

@Module({ controllers: [ClubsController], providers: [ClubService], exports: [ClubService] })
export class ClubsModule {}
