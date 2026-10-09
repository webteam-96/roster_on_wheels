import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service";

/** Services used across modules (the shared registrations of Program.cs). */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class SharedModule {}
