import { Controller, Get, Post } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, forbid, notFound, ok } from "../../common/results";
import { RotaryYearDto } from "../../dtos/reference.dtos";
import { ensureRotaryYear } from "../../services/year-table.resolver";

/** Port of RotaryYearsController.cs + RotaryYearService.cs: api/rotary-years. */
@Controller("api/rotary-years")
@Authorize()
export class RotaryYearsController {
  constructor(private readonly db: Db) {}

  private isSuperAdmin(user: CurrentUser) {
    return (user.findFirst("roles") ?? "").includes("SuperAdmin");
  }

  @Get()
  async getAll() {
    return RotaryYearDto.mapAll(await this.db.callProcedure("sp_rotary_year_get_all"));
  }

  @Get("current")
  async getCurrent() {
    const row = (await this.db.callProcedure("sp_rotary_year_get_current"))[0];
    if (!row) return notFound({ message: "Current rotary year not found" });
    return ok(RotaryYearDto.map(row));
  }

  @Post("add-next")
  async addNext(@User() user: CurrentUser) {
    if (!this.isSuperAdmin(user)) return forbid();
    return this.db.session(async (conn) => {
      const latestStart = await conn.executeScalar<string>("SELECT MAX(StartDate) FROM rotary_year_master WHERE isdeleted = 0");
      if (!latestStart) return badRequest({ message: "No existing rotary years found." });
      const nextStartYear = Number(latestStart.slice(0, 4)) + 1;
      const newId = await ensureRotaryYear(conn, `${nextStartYear}-07-01`);
      const label = `${nextStartYear}-${String((nextStartYear + 1) % 100).padStart(2, "0")}`;
      return ok({ id: newId, yearLabel: label, message: `Rotary year ${label} added.` });
    });
  }
}
