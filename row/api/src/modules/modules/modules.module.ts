import { Module } from "@nestjs/common";
import { ModulesController } from "./modules.controller";
import { ModuleService } from "./modules.service";

@Module({ controllers: [ModulesController], providers: [ModuleService], exports: [ModuleService] })
export class ModulesModule {}
