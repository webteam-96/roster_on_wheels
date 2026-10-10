import { Controller, Get, Param } from "@nestjs/common";
import { Authorize } from "../../auth/decorators";
import { paramInt } from "../../common/binding";
import { ok, statusCode } from "../../common/results";
import { Db } from "../../database/db.service";
import { CLUB_BLOCKED_MESSAGE, DISTRICT_BLOCKED_MESSAGE, isClubDrillReachable, isDistrictDrillReachable } from "../../services/kill-switch.helper";
import { ClubGroupsService } from "../club-groups/club-groups.service";
import { RiDirectorService } from "../ri-director/ri-director.service";

/** Port of MobileWeblinksController.cs: view-only weblinks (RI flat list filtered to active; district/club trees). */
@Controller("api/mobile")
@Authorize()
export class MobileWeblinksController {
  constructor(private readonly groups: ClubGroupsService, private readonly ri: RiDirectorService, private readonly db: Db) {}

  @Get("weblinks/ri")
  async ri_() {
    return ok((await this.ri.getWeblinks()).filter((w) => w.isActive === true));
  }

  @Get("districts/:districtId/weblinks")
  async district(@Param("districtId") d: string) {
    const districtId = paramInt(d, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    return ok(await this.groups.getWeblinkTree(0, districtId));
  }

  @Get("clubs/:clubId/weblinks")
  async club(@Param("clubId") c: string) {
    const clubId = paramInt(c, "clubId");
    if (!(await isClubDrillReachable(this.db, clubId))) return statusCode(403, { message: CLUB_BLOCKED_MESSAGE });
    return ok(await this.groups.getWeblinkTree(clubId));
  }
}
