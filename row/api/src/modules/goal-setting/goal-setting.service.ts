import { Injectable } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { RoleService } from "../roles/role.service";
import { GoalImports } from "./goal-imports";

/**
 * Port of GoalSettingService.cs. The C# class is one 8,600-line file; here it is a chain of
 * layers, each in its own file: goal-core (scope, fields, saves, locks) → goal-forms (forms,
 * month-wise, target split) → goal-reports (Excel reports) → goal-matrices (club lists,
 * matrices, overview) → goal-roles (oversight roles) → goal-messaging → goal-imports.
 */
@Injectable()
export class GoalSettingService extends GoalImports {
  constructor(db: Db, roleService: RoleService, config: AppConfig) {
    super(db, roleService, config);
  }
}
