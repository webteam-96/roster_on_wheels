import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectApprovalController } from "./project-approval.controller";
import { ProjectService } from "./project.service";
import { ProjectApprovalService } from "./project-approval.service";
import { ApprovalsModule } from "../approvals/approvals.module";

/** Club projects and their club-moderator approval. */
@Module({
  imports: [ApprovalsModule],
  controllers: [ProjectsController, ProjectApprovalController],
  providers: [ProjectService, ProjectApprovalService],
  exports: [ProjectService, ProjectApprovalService],
})
export class ProjectsModule {}
