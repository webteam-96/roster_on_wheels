import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { RoleService } from "./role.service";

@Module({ controllers: [AdminController], providers: [RoleService], exports: [RoleService] })
export class RolesModule {}
