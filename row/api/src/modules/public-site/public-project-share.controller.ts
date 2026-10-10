import { Controller, Get, Logger, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AllowAnonymous } from "../../auth/decorators";
import { queryInt, routeInt } from "../../common/binding";
import { file, notFound, ok } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { Db, type DbCommands } from "../../database/db.service";
import { webRootPath } from "../../services/media-storage";
import { buildWebsiteUrl } from "../../services/member-scopes.helper";
import { renderShareCard } from "../../services/project-share-card";
import { normaliseText, truncateText } from "../../services/whatsapp-template-text";
import { YearTableResolver, type YearTableInfo } from "../../services/year-table.resolver";
import { loadMediaBytes } from "../monthly-reports/cmr-documents";

const SUMMARY_MAX = 200, TITLE_MAX = 110;
interface ShareRow { id: number; yearId: number; yearLabel: string; title: string | null; description: string | null; areaOfFocus: string | null; clubId: number; clubName: string | null; districtNumber: string | null; primaryPhoto: string | null }

export const clubDisplayName = (clubName: string | null | undefined) => {
  const n = (clubName ?? "").trim();
  return !n ? "Rotary Club" : /^rotary/i.test(n) ? n : `Rotary Club of ${n}`;
};
/** Multi-line: for the clipboard / native share sheet (not for a WhatsApp template body). */
export function buildShareText(title: string, club: string, district: string | null, summary: string, url: string) {
  let s = `${title}\n${club}`;
  if (district && district.trim()) s += ` | RI District ${district.trim()}`;
  s += "\n";
  if (summary && summary.trim()) s += `\n${summary}\n`;
  return `${s}\n${url}`;
}
/** Single line: safe as a WhatsApp template variable. */
export function buildShareTextSingleLine(title: string, club: string, district: string | null, summary: string, url: string) {
  const parts = [title, club];
  if (district && district.trim()) parts.push(`RI District ${district.trim()}`);
  let s = parts.join(" - ");
  if (summary && summary.trim()) s += `. ${summary}`;
  return `${s} ${url}`.replace(/[\n\r]/g, " ");
}
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ""; } };

/**
 * Port of PublicProjectShareController.cs: one share payload and one 1200×630 preview card for every surface.
 * Shareable as soon as created (anything but Rejected) on an active club → district → zone chain. The share
 * URL is the club's live website when it has one, else the public project page.
 */
@Controller("api/public/projects")
@AllowAnonymous()
export class PublicProjectShareController {
  private readonly log = new Logger("PublicProjectShareController");
  constructor(private readonly db: Db, private readonly yearTables: YearTableResolver, private readonly config: AppConfig) {}

  @Get(":id/share")
  async share(@Param("id") i: string, @Req() req: Request, @Res({ passthrough: true }) res: Response, @Query("yearId") y?: string) {
    const id = routeInt(i);
    const yearId = queryInt(y);
    res.setHeader("Cache-Control", "public,max-age=300");
    return this.db.session(async (conn) => {
      const p = await this.load(conn, id, yearId);
      if (!p) return notFound({ message: "Project not found." });
      const { shareUrl, clubSiteBase } = await this.shareUrl(conn, p);
      const club = clubDisplayName(p.clubName);
      const summary = truncateText(normaliseText(p.description), SUMMARY_MAX);
      const title = !p.title || !p.title.trim() ? "Rotary service project" : p.title.trim();
      return ok({
        id: p.id, yearId: p.yearId, title, clubName: p.clubName ?? "", clubDisplayName: club, districtNumber: p.districtNumber ?? "", areaOfFocus: p.areaOfFocus, summary,
        shareText: buildShareText(title, club, p.districtNumber, summary, shareUrl), shareTextSingleLine: buildShareTextSingleLine(title, club, p.districtNumber, summary, shareUrl),
        shareUrl, imageUrl: `${this.apiBase(req)}/api/public/projects/${p.id}/share-image.png?yearId=${p.yearId}`,
        hasClubWebsite: clubSiteBase.length > 0, clubWebsiteUrl: clubSiteBase.length > 0 ? clubSiteBase : null,
      });
    });
  }

  /** Rendered on demand and cached on disk, keyed by everything the card draws. */
  @Get(":id/share-image.png")
  async shareImage(@Param("id") i: string, @Res({ passthrough: true }) res: Response, @Query("yearId") y?: string) {
    const id = routeInt(i);
    const yearId = queryInt(y);
    res.setHeader("Cache-Control", "public,max-age=86400");
    return this.db.session(async (conn) => {
      const p = await this.load(conn, id, yearId);
      if (!p) return notFound({ message: "Project not found." });
      const { shareUrl } = await this.shareUrl(conn, p);
      const title = truncateText(normaliseText(p.title), TITLE_MAX) || "Rotary service project";
      const summary = truncateText(normaliseText(p.description), SUMMARY_MAX);
      const club = clubDisplayName(p.clubName);
      const stamp = createHash("sha256").update(`${title}|${club}|${p.districtNumber ?? ""}|${p.areaOfFocus ?? ""}|${summary}|${p.primaryPhoto ?? ""}|${hostOf(shareUrl)}|v1`, "utf8")
        .digest("hex").slice(0, 12);
      const dir = join(webRootPath(this.config), "Documents", "share-cache", p.yearLabel.replace(/[^0-9A-Za-z_-]/g, "") || "unknown");
      const cacheFile = join(dir, `p${p.id}-${stamp}.png`);
      if (existsSync(cacheFile)) {
        try {
          return file(await readFile(cacheFile), "image/png");
        } catch {
          // mid-write or locked: regenerate
        }
      }
      let png: Buffer;
      try {
        png = await renderShareCard({ title, clubDisplayName: club, districtNumber: p.districtNumber ?? "", areaOfFocus: p.areaOfFocus, summary, footerHost: hostOf(shareUrl),
          photoBytes: await loadMediaBytes(webRootPath(this.config), this.config.get("Media:RedirectBaseUrl") ?? null, p.primaryPhoto) });
      } catch (e) {
        this.log.error(`Share card render failed for project ${p.id} (${p.yearLabel}): ${(e as Error).message}`);
        return notFound({ message: "Share image unavailable." });
      }
      await this.writeCache(dir, cacheFile, p.id, png);
      return file(png, "image/png");
    });
  }

  /** At most one card per project per year; write-then-rename so a reader never sees half a PNG. */
  private async writeCache(dir: string, cacheFile: string, id: number, png: Buffer) {
    try {
      await mkdir(dir, { recursive: true });
      for (const f of await readdir(dir)) if (f.startsWith(`p${id}-`) && f.endsWith(".png") && join(dir, f) !== cacheFile) await unlink(join(dir, f)).catch(() => undefined);
      const tmp = `${cacheFile}.${randomUUID().replace(/-/g, "").slice(0, 8)}.tmp`;
      await writeFile(tmp, png);
      await rename(tmp, cacheFile);
    } catch (e) {
      this.log.warn(`Could not cache share image for project ${id}: ${(e as Error).message}`);
    }
  }

  /** With a yearId, that (id, year) pair only; a legacy link without one takes the first year table that passes the public filter. */
  private async load(conn: DbCommands, id: number, yearId: number | null): Promise<ShareRow | null> {
    if (yearId !== null && yearId > 0) {
      const info = await this.yearTables.resolveByYearId(conn, yearId);
      return info ? this.queryOne(conn, info, id) : null;
    }
    for (const t of await this.yearTables.getAllExistingYearTables(conn)) {
      const hit = await this.queryOne(conn, t, id);
      if (hit) return hit;
    }
    return null;
  }

  private async queryOne(conn: DbCommands, t: YearTableInfo, id: number): Promise<ShareRow | null> {
    const suffix = t.yearLabel.replace(/-/g, "_");
    try {
      const r = await conn.queryFirstOrDefault(
        `SELECT p.pk_project_id AS id, p.fk_year_id AS yearId, CONVERT(p.title USING utf8mb4) AS title, CONVERT(p.description USING utf8mb4) AS description,
                CONVERT(COALESCE(NULLIF(aof.name,''), NULLIF(p.other_area_of_focus,'')) USING utf8mb4) AS areaOfFocus, p.fk_club_id AS clubId,
                CONVERT(c.ClubName USING utf8mb4) AS clubName, CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber,
                CONVERT((SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/', CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk) ELSE CONCAT('${suffix}/Album', p.pk_project_id) END,
                                       '/', ph.image_path)
                         FROM \`${t.photosTable}\` ph WHERE ph.fk_project_id = p.pk_project_id ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id LIMIT 1) USING utf8mb4) AS primaryPhoto
         FROM \`${t.projectsTable}\` p
         JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
         JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
         JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
         LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
         WHERE p.pk_project_id = @Id AND p.isdeleted = 0 AND p.is_active = 1 AND COALESCE(p.approval_status,'') <> 'Rejected' LIMIT 1`, { Id: id });
      if (!r) return null;
      const yearIdOf = Number(r.yearId ?? 0);
      // Stored area names carry odd padding; legacy rows can carry a stale fk_year_id.
      return { id: Number(r.id), yearId: yearIdOf > 0 ? yearIdOf : t.yearId, yearLabel: t.yearLabel, title: r.title, description: r.description,
        areaOfFocus: r.areaOfFocus && String(r.areaOfFocus).trim() ? String(r.areaOfFocus).trim() : null, clubId: Number(r.clubId), clubName: r.clubName, districtNumber: r.districtNumber,
        primaryPhoto: r.primaryPhoto };
    } catch {
      // a year table whose photos twin is missing: skipped
      return null;
    }
  }

  /** The club's live site (active, unexpired, active chain) project page, else the main public project page. */
  private async shareUrl(conn: DbCommands, p: ShareRow) {
    const site = await conn.queryFirstOrDefault(
      `SELECT CONVERT(cw.Subdomain USING utf8mb4) AS subdomain, CONVERT(cw.ClientDomain USING utf8mb4) AS clientDomain
       FROM club_websites cw
       JOIN club_master c ON c.pk_club_id = cw.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
       JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
       JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1
       WHERE cw.fk_club_id = @ClubId AND COALESCE(cw.isdeleted, 0) = 0 AND cw.Status = 'Active' AND CURDATE() BETWEEN cw.StartDate AND cw.EndDate LIMIT 1`, { ClubId: p.clubId });
    if (site) {
      const parentSetting = await conn.executeScalar<string>("SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain'");
      const parent = parentSetting && parentSetting.trim() ? parentSetting : Brand.Current.domains.clubSiteParent;
      const base = buildWebsiteUrl(site.clientDomain?.trim() ?? null, site.subdomain?.trim() ?? null, parent);
      if (base && base.trim()) {
        const b = base.replace(/\/+$/, "");
        return { shareUrl: `${b}/project?pid=${p.id}&yearId=${p.yearId}`, clubSiteBase: b };
      }
    }
    const pub = this.config.get("PublicFrontend:BaseUrl") || this.config.get("FrontendUrl") || Brand.Current.domains.adminOrigin;
    return { shareUrl: `${pub.replace(/\/+$/, "")}/projects/${p.id}?yearId=${p.yearId}`, clubSiteBase: "" };
  }

  private apiBase(req: Request) {
    const v = this.config.get("Api:BaseUrl");
    return v && v.trim() ? v.replace(/\/+$/, "") : `${req.protocol}://${req.get("host")}${req.baseUrl ?? ""}`.replace(/\/+$/, "");
  }
}
