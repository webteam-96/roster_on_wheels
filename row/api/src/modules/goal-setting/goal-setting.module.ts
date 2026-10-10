import { Module } from "@nestjs/common";
import { RolesModule } from "../roles/roles.module";
import { ClubFoundationGoalsController, MobileClubFoundationGoalsController } from "./club-foundation-goals.controller";
import { FoundationGoalsService } from "./foundation-goals.service";
import { GoalSettingController } from "./goal-setting.controller";
import { GoalSettingService } from "./goal-setting.service";
import { MobileGoalSettingController } from "./mobile-goal-setting.controller";

@Module({
  imports: [RolesModule],
  controllers: [GoalSettingController, MobileGoalSettingController, ClubFoundationGoalsController, MobileClubFoundationGoalsController],
  providers: [GoalSettingService, FoundationGoalsService],
  exports: [GoalSettingService],
})
export class GoalSettingModule {}
