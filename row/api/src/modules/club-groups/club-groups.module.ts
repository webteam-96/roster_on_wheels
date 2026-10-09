import { Module } from "@nestjs/common";
import { ClubGroupsController } from "./club-groups.controller";
import { ClubGroupsService } from "./club-groups.service";

/** Club sub-groups, weblinks and attendance. */
@Module({ controllers: [ClubGroupsController], providers: [ClubGroupsService], exports: [ClubGroupsService] })
export class ClubGroupsModule {}
