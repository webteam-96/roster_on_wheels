import { Module } from "@nestjs/common";
import { BeneficiaryApprovalController, ZonalDashboardController } from "./approvals.controller";
import { BeneficiaryApprovalService } from "./beneficiary-approval.service";

/** Beneficiary-limit approvals and the Zonal Co-ordinator dashboard. */
@Module({ controllers: [BeneficiaryApprovalController, ZonalDashboardController], providers: [BeneficiaryApprovalService], exports: [BeneficiaryApprovalService] })
export class ApprovalsModule {}
