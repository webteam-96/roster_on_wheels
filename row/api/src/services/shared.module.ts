import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service";
import { YearTableResolver } from "./year-table.resolver";
import { AuditLogService } from "./audit-log.service";
import { DcAutoGroupService } from "./dc-auto-group.service";

/** Services used across modules (the shared registrations of Program.cs). */
@Global()
@Module({
  providers: [EmailService, YearTableResolver, AuditLogService, DcAutoGroupService],
  exports: [EmailService, YearTableResolver, AuditLogService, DcAutoGroupService],
})
export class SharedModule {}
