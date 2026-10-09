import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service";
import { YearTableResolver } from "./year-table.resolver";
import { AuditLogService } from "./audit-log.service";

/** Services used across modules (the shared registrations of Program.cs). */
@Global()
@Module({
  providers: [EmailService, YearTableResolver, AuditLogService],
  exports: [EmailService, YearTableResolver, AuditLogService],
})
export class SharedModule {}
