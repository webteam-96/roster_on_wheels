import { Controller, Get } from "@nestjs/common";
import { AllowAnonymous } from "../auth/decorators";
import { Db } from "../database/db.service";
import { Brand } from "../brand/brand";
import { statusCode } from "../common/results";

const startedAtUtc = new Date().toISOString();

/**
 * GET api/health (master plan WS0-01): status, version, commit, instance and
 * whether the database answers. Version and commit come from the deploy
 * (BUILD_VERSION, BUILD_COMMIT). 503 when the database does not answer.
 */
@Controller("api/health")
@AllowAnonymous()
export class HealthController {
  constructor(private readonly db: Db) {}

  @Get()
  async get() {
    let dbOk = false;
    try {
      dbOk = (await this.db.executeScalar<number>("SELECT 1")) === 1;
    } catch {
      dbOk = false;
    }
    const body = {
      status: dbOk ? "ok" : "degraded",
      version: process.env.BUILD_VERSION ?? "dev",
      commit: process.env.BUILD_COMMIT ?? "",
      instance: Brand.Current.instanceCode,
      dbOk,
      startedAtUtc,
    };
    return dbOk ? body : statusCode(503, body);
  }
}
