import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { CoreModule } from "./core/core.module";
import { AuthGuard } from "./auth/auth.guard";
import { DotnetExceptionFilter } from "./common/exception.filter";
import { MobileJwtRefreshInterceptor } from "./pipeline/mobile-jwt-refresh.interceptor";
import { AuditMiddleware } from "./pipeline/audit.middleware";
import { HealthController } from "./health/health.controller";
import { PublicBrandController } from "./brand/public-brand.controller";
import { FEATURE_MODULES } from "./modules";

/**
 * The application: the pipeline of Program.cs (authentication on every request,
 * mobile token refresh, audit log, error mapping) and one Nest module per
 * group of ported controllers (src/modules/index.ts).
 */
@Module({
  imports: [CoreModule, ScheduleModule.forRoot(), ...FEATURE_MODULES],
  controllers: [HealthController, PublicBrandController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: MobileJwtRefreshInterceptor },
    { provide: APP_FILTER, useClass: DotnetExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditMiddleware).forRoutes("*");
  }
}
