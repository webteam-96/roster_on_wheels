import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { Db } from "../database/db.service";
import type { CurrentUser } from "../auth/current-user";

/**
 * Port of AuditMiddleware.cs: every successful POST/PUT/DELETE outside the
 * skipped prefixes writes one audit_log row (who, what, which entity). Runs
 * after the response is sent and never affects it.
 */
const ENTITY_MAP: Record<string, string> = Object.fromEntries(
  Object.entries({
    projects: "Project", announcements: "Announcement", "upcoming-events": "Upcoming Event", newsletters: "Newsletter",
    documents: "Document", attendance: "Attendance", "board-of-directors": "Board of Directors", greetings: "Greeting",
    weblinks: "Weblink", "sub-groups": "Sub Group", "potential-members": "Potential Member", "past-presidents": "Past President",
    trf: "TRF Contribution", "pph-camps": "PPH Camp", "membership-dues": "Club Dues", "club-monthly-report": "Club Monthly Report",
    about: "Website About", banners: "Website Banner", menu_list: "Website Menu", menus: "Website Menu",
    social_media_links: "Website Social Link", "social-links": "Website Social Link", contact_details: "Website Contact",
    "contact-details": "Website Contact", advertisements: "Website Advertisement", theme: "Website Theme",
    committee: "District Committee", groups: "Committee Group", "district-events": "District Event",
    "club-moderators": "Club Moderator", ag: "Assistant Governor", "mass-emails": "Mass Email", citation: "District Awards",
    "ri-director": "RI Director", clubs: "Club", districts: "District", members: "Member", zones: "Zone",
    "area-of-focus": "Area of Focus", categories: "Category", "sub-categories": "Sub Category", funding: "Funding",
    designations: "Designation", themes: "Theme", "website-data-modules": "Website Data Module", modules: "Module",
    "module-categories": "Module Category", "credit-management": "Credit Management", credits: "RI Director Credit",
    "event-masters": "Event Master", "event-payment": "Event Payment", "tshirt-sizes": "T-Shirt Size",
    "food-preferences": "Food Preference", "rotary-years": "Rotary Year",
    "zonal-awards": "Zonal Award", "project-approval": "Project Approval", "document-types": "Document Type", funds: "Fund",
  }).map(([k, v]) => [k.toLowerCase(), v]),
);

const SKIP_PREFIXES = ["/api/auth", "/api/mobile-auth", "/api/public/", "/api/whatsapp-info", "/api/district-directory", "/swagger", "/api/countries"];
const NAME_FIELDS = ["title", "Title", "name", "Name", "clubName", "ClubName", "groupName", "group_name", "subGroupName",
  "sub_group_name", "designationName", "designation_name", "description", "subject", "Subject", "moduleName"];

const isInt = (s: string) => /^[+-]?\d+$/.test(s.trim());

export function resolveEntityType(path: string): string {
  const segments = path.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (isInt(segments[i]) || segments[i] === "api") continue;
    const hit = ENTITY_MAP[segments[i].toLowerCase()];
    if (hit) return hit;
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!isInt(segments[i]) && segments[i] !== "api") return segments[i];
  }
  return "Unknown";
}

export function extractEntityId(path: string): number | null {
  const segments = path.split("/");
  for (let i = segments.length - 1; i >= 0; i--) if (segments[i] && isInt(segments[i])) return parseInt(segments[i], 10);
  return null;
}

export function extractEntityName(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const field of NAME_FIELDS) {
    const v = (body as Record<string, unknown>)[field];
    if (typeof v === "string" && v.trim()) return v.length > 200 ? v.slice(0, 200) : v;
  }
  return null;
}

export function auditAction(method: string, path: string): string {
  let action = method === "POST" ? "Create" : method === "PUT" ? "Update" : method === "DELETE" ? "Delete" : method;
  const p = path.toLowerCase();
  if (p.includes("/reorder")) action = "Reorder";
  if (p.includes("/upload")) action = "Upload";
  if (p.includes("/approve")) action = "Approve";
  if (p.includes("/reject")) action = "Reject";
  if (p.includes("/assign")) action = "Assign";
  if (p.includes("/remove")) action = "Remove";
  return action;
}

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  private readonly log = new Logger("Audit");
  constructor(private readonly db: Db) {}

  use(req: Request & { user?: CurrentUser }, res: Response, next: NextFunction): void {
    const method = req.method.toUpperCase();
    // Inside Nest's mounted middleware req.path is relative to the mount: rebuild the full path.
    const path = req.baseUrl && req.path === "/" ? req.baseUrl : (req.baseUrl || "") + req.path;
    if ((method !== "POST" && method !== "PUT" && method !== "DELETE") || SKIP_PREFIXES.some((p) => path.toLowerCase().startsWith(p))) {
      next();
      return;
    }
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const user = req.user;
      const isJson = (req.headers["content-type"] ?? "").includes("application/json");
      const userAgent = req.headers["user-agent"] ?? "";
      this.db
        .execute(
          `INSERT INTO audit_log (fk_member_master_profile_id, member_name, role_name, action, entity_type,
              entity_id, entity_name, details, ip_address, user_agent, created_date)
           VALUES (@MemberId, @MemberName, @RoleName, @Action, @EntityType,
              @EntityId, @EntityName, @Details, @IpAddress, @UserAgent, NOW())`,
          {
            MemberId: user?.intClaim("memberId") ?? null,
            MemberName: user?.findFirst("name") ?? "System",
            RoleName: user?.findFirst("roles") ?? "",
            Action: auditAction(method, path),
            EntityType: resolveEntityType(path),
            EntityId: extractEntityId(path),
            EntityName: isJson ? extractEntityName(req.body) : null,
            Details: `${method} ${path}`,
            IpAddress: req.ip ?? "",
            UserAgent: userAgent.length > 500 ? userAgent.slice(0, 500) : userAgent,
          },
        )
        // never fails the request, as in the C# (empty catch)
        .catch((e: Error) => this.log.debug(`audit write skipped: ${e.message}`));
    });
    next();
  }
}
