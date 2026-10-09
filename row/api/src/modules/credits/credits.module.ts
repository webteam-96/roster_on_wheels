import { Module } from "@nestjs/common";
import { CreditManagementController } from "./credit-management.controller";

@Module({ controllers: [CreditManagementController] })
export class CreditsModule {}
