import { Controller, Get, Query } from "@nestjs/common";
import { Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { queryInt, queryString } from "../../common/binding";
import { ok, unauthorized } from "../../common/results";
import { MobileNotificationFeedService } from "./mobile-notification-feed.service";

/** Port of MobileNotificationsController.cs: the bell-icon feed. */
@Controller("api/mobile")
@Authorize()
export class MobileNotificationsController {
  constructor(private readonly feed: MobileNotificationFeedService) {}

  @Get("notifications")
  async notifications(@User() u: CurrentUser, @Query("page") p?: string, @Query("pageSize") ps?: string, @Query("days") d?: string, @Query("types") t?: string) {
    const v = u.findFirst("memberId") ?? "";
    const memberId = /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : 0;
    if (memberId <= 0) return unauthorized();
    return ok(await this.feed.getFeed(memberId, queryInt(p, 1), queryInt(ps, 20), queryInt(d, 90), queryString(t)));
  }
}
