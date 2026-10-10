import { Body, Controller, Get, Logger, Post, Query } from "@nestjs/common";
import { Authorize } from "../../auth/decorators";
import { bodyField, queryInt, queryString } from "../../common/binding";
import { defineDto } from "../../common/dto";
import { badRequest, ok, statusCode } from "../../common/results";
import { AppConfig } from "../../config/app-config";
import { Db } from "../../database/db.service";

export const ClassificationSearchResultDto = defineDto({
  Type: { type: "string", default: () => "" }, AreaOfFocusId: "int", AreaOfFocusName: { type: "string", default: () => "" }, CategoryId: "int?", CategoryName: "string",
  SubCategoryId: "int?", SubCategoryName: "string", ModuleId: "int?", ModuleKey: "string", ModuleName: "string",
});

export const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** Exact (normalised) name, then a lenient contains-either-way match. */
export function pickByName<T>(items: T[], name: string | null, sel: (x: T) => string): T | null {
  if (!name || !name.trim()) return null;
  const n = norm(name);
  const hit = items.find((x) => norm(sel(x)) === n);
  if (hit) return hit;
  if (n.length >= 3) return items.find((x) => { const c = norm(sel(x)); return c.length >= 3 && (c.includes(n) || n.includes(c)); }) ?? null;
  return null;
}
type Area = { AreaOfFocusId: number; AreaOfFocusName: string };
type Cat = { CategoryId: number; CategoryName: string; AreaOfFocusId: number };
type Sub = { SubCategoryId: number; SubCategoryName: string; CategoryId: number };
type Other = { ModuleId: number; ModuleKey: string; ModuleName: string; AreaOfFocusId: number; AreaOfFocusName: string };

/** Port of ProjectClassificationController.cs: one search over area → category → sub-category, and the Gemini suggestion. */
@Controller()
@Authorize()
export class ProjectClassificationController {
  private readonly log = new Logger("ProjectClassificationController");
  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  /** Ranked: starts-with, then whole word, then substring; area before category before sub-category. */
  @Get("api/project-classification/search")
  async search(@Query("q") q?: string, @Query("moduleId") m?: string) {
    const term = (queryString(q) ?? "").trim();
    if (term.length < 1) return ok([]);
    const rows = await this.db.query(
      `SELECT type, areaOfFocusId, areaOfFocusName, categoryId, categoryName, subCategoryId, subCategoryName
       FROM (
           SELECT 'area' AS type, a.pk_area_of_focus_id AS areaOfFocusId, a.name AS areaOfFocusName, NULL AS categoryId, NULL AS categoryName, NULL AS subCategoryId, NULL AS subCategoryName,
                  1 AS ord, a.name AS nm, CASE WHEN a.name LIKE @QStart THEN 0 WHEN a.name LIKE @QWord THEN 1 ELSE 2 END AS rnk
           FROM area_of_focus_master a
           WHERE a.is_active = 1 AND a.isdeleted = 0 AND (@ModuleId = 0 OR a.fk_module_id = @ModuleId) AND a.name LIKE @Q
           UNION ALL
           SELECT 'category', a.pk_area_of_focus_id, a.name, c.pk_category_id, c.name, NULL, NULL, 2, c.name,
                  CASE WHEN c.name LIKE @QStart THEN 0 WHEN c.name LIKE @QWord THEN 1 ELSE 2 END
           FROM category_master c JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id
           WHERE c.is_active = 1 AND c.isdeleted = 0 AND a.is_active = 1 AND a.isdeleted = 0 AND (@ModuleId = 0 OR a.fk_module_id = @ModuleId) AND c.name LIKE @Q
           UNION ALL
           SELECT 'subcategory', a.pk_area_of_focus_id, a.name, c.pk_category_id, c.name, s.pk_sub_category_id, s.name, 3, s.name,
                  CASE WHEN s.name LIKE @QStart THEN 0 WHEN s.name LIKE @QWord THEN 1 ELSE 2 END
           FROM sub_category_master s JOIN category_master c ON c.pk_category_id = s.fk_category_id JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id
           WHERE s.is_active = 1 AND s.isdeleted = 0 AND c.is_active = 1 AND c.isdeleted = 0 AND a.is_active = 1 AND a.isdeleted = 0
             AND (@ModuleId = 0 OR a.fk_module_id = @ModuleId) AND s.name LIKE @Q
       ) u
       ORDER BY u.rnk, u.ord, u.nm
       LIMIT 50`,
      { ModuleId: queryInt(m, 0), Q: `%${term}%`, QStart: `${term}%`, QWord: `% ${term}%` },
    );
    return ok(ClassificationSearchResultDto.mapAll(rows));
  }

  /** The model answers with names (scoped to the current module's taxonomy); names are resolved to ids here. */
  @Post("api/project-classification/suggest")
  async suggest(@Body() body: unknown) {
    const apiKey = this.config.get("Gemini:ApiKey");
    if (!apiKey || !apiKey.trim() || apiKey.toUpperCase().includes("PLACEHOLDER")) return statusCode(501, { message: "AI suggestions are not configured (missing Gemini API key)." });
    const title = String(bodyField(body, "title") ?? "").trim();
    const desc = String(bodyField(body, "description") ?? "").trim();
    const moduleId = Math.trunc(Number(bodyField(body, "moduleId")) || 0);
    if (!title && !desc) return badRequest({ message: "Enter a title or description first." });

    const cur = await this.db.queryFirstOrDefault("SELECT ModuleKey AS ModuleKey, ModuleName AS ModuleName FROM module_master WHERE pk_module_id = @ModuleId AND isdeleted = 0", { ModuleId: moduleId });
    const moduleKey = String(cur?.ModuleKey ?? ""), moduleName = String(cur?.ModuleName ?? "this");
    const p = { ModuleId: moduleId };
    const areas = (await this.db.query("SELECT a.pk_area_of_focus_id AS AreaOfFocusId, a.name AS AreaOfFocusName FROM area_of_focus_master a WHERE a.fk_module_id = @ModuleId AND a.is_active = 1 AND a.isdeleted = 0 ORDER BY a.name", p)) as unknown as Area[];
    if (areas.length === 0) return ok({ matches: [], betterModule: null });
    const cats = (await this.db.query(
      `SELECT c.pk_category_id AS CategoryId, c.name AS CategoryName, c.fk_area_of_focus_id AS AreaOfFocusId
       FROM category_master c JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id
       WHERE a.fk_module_id = @ModuleId AND c.is_active = 1 AND c.isdeleted = 0 AND a.is_active = 1 AND a.isdeleted = 0 ORDER BY c.name`, p)) as unknown as Cat[];
    const subs = (await this.db.query(
      `SELECT s.pk_sub_category_id AS SubCategoryId, s.name AS SubCategoryName, s.fk_category_id AS CategoryId
       FROM sub_category_master s JOIN category_master c ON c.pk_category_id = s.fk_category_id JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id
       WHERE a.fk_module_id = @ModuleId AND s.is_active = 1 AND s.isdeleted = 0 AND c.is_active = 1 AND c.isdeleted = 0 AND a.is_active = 1 AND a.isdeleted = 0 ORDER BY s.name`, p)) as unknown as Sub[];
    const others = (await this.db.query(
      `SELECT m.pk_module_id AS ModuleId, m.ModuleKey AS ModuleKey, m.ModuleName AS ModuleName, a.pk_area_of_focus_id AS AreaOfFocusId, a.name AS AreaOfFocusName
       FROM area_of_focus_master a JOIN module_master m ON m.pk_module_id = a.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
       WHERE a.is_active = 1 AND a.isdeleted = 0 AND m.pk_module_id <> @ModuleId
         AND m.ModuleKey IN ('community_service','vocational_service','international_service','new_generation_service','public_image_initiative')
       ORDER BY m.ModuleName, a.name`, p)) as unknown as Other[];

    let tax = "";
    for (const a of areas) {
      const aCats = cats.filter((c) => Number(c.AreaOfFocusId) === Number(a.AreaOfFocusId));
      if (aCats.length === 0) { tax += `- ${a.AreaOfFocusName} (no categories)\n`; continue; }
      tax += `- ${a.AreaOfFocusName}\n`;
      for (const c of aCats) {
        const cs = subs.filter((s) => Number(s.CategoryId) === Number(c.CategoryId)).map((s) => s.SubCategoryName);
        tax += `   - ${c.CategoryName}${cs.length === 0 ? " (no sub-categories)\n" : `: ${cs.join(" | ")}\n`}`;
      }
    }
    const byModule = new Map<string, string[]>();
    for (const o of others) byModule.set(o.ModuleName, [...(byModule.get(o.ModuleName) ?? []), o.AreaOfFocusName]);
    const otherText = [...byModule].map(([m, a]) => `- ${m}: ${a.join(", ")}\n`).join("");
    const prompt =
      "You classify a Rotary club project into a fixed taxonomy.\n" +
      `The user is filling in the "${moduleName}" project form.\n\n` +
      `TAXONOMY for "${moduleName}" (choose ONLY from these exact names):\n${tax}\n` +
      `OTHER project types and their areas of focus (for the betterModule hint only):\n${otherText}\n` +
      "Read the project title and description, then return ONLY JSON:\n" +
      '{"matches":[{"areaOfFocus":"..","category":null,"subCategory":null}],"betterModule":null}\n' +
      `- "matches": the 1-3 best entries from the "${moduleName}" TAXONOMY above, best first. ` +
      "Always give areaOfFocus; also give category if the chosen area lists categories, and subCategory if that " +
      "category lists sub-categories. Use the EXACT names shown; use null for a level that does not apply.\n" +
      `- "betterModule": ONLY if the project clearly belongs to a DIFFERENT project type than "${moduleName}", ` +
      'set {"module":<one OTHER project type>,"areaOfFocus":<one of that type\'s areas>}; otherwise null.\n\n' +
      `Project title: ${title}\nProject description: ${desc}`;
    const model = this.config.get("Gemini:Model") ?? "gemini-2.0-flash";
    let respBody: string;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
      });
      respBody = await res.text();
      if (!res.ok) {
        this.log.error(`Gemini classify failed: ${res.status} ${respBody}`);
        return statusCode(502, { message: "The AI service is unavailable right now. Please try again." });
      }
    } catch (e) {
      this.log.error(`Gemini classify request failed: ${(e as Error).message}`);
      return statusCode(502, { message: "The AI service is unavailable right now. Please try again." });
    }
    try {
      const text = JSON.parse(respBody).candidates[0].content.parts[0].text as string;
      const root = JSON.parse(text);
      const str = (o: Record<string, unknown>, k: string) => (typeof o?.[k] === "string" ? (o[k] as string) : null);
      const matches: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      for (const m of Array.isArray(root.matches) ? root.matches : []) {
        if (!m || typeof m !== "object") continue;
        const a = pickByName(areas, str(m, "areaOfFocus"), (x) => x.AreaOfFocusName);
        if (!a) continue;
        const dto: Record<string, unknown> = { Type: "area", ModuleId: moduleId, ModuleKey: moduleKey, ModuleName: moduleName, AreaOfFocusId: a.AreaOfFocusId, AreaOfFocusName: a.AreaOfFocusName };
        const c = pickByName(cats.filter((x) => Number(x.AreaOfFocusId) === Number(a.AreaOfFocusId)), str(m, "category"), (x) => x.CategoryName);
        if (c) {
          Object.assign(dto, { Type: "category", CategoryId: c.CategoryId, CategoryName: c.CategoryName });
          const s = pickByName(subs.filter((x) => Number(x.CategoryId) === Number(c.CategoryId)), str(m, "subCategory"), (x) => x.SubCategoryName);
          if (s) Object.assign(dto, { Type: "subcategory", SubCategoryId: s.SubCategoryId, SubCategoryName: s.SubCategoryName });
        }
        const key = `${dto.AreaOfFocusId}/${dto.CategoryId ?? ""}/${dto.SubCategoryId ?? ""}`;
        if (!seen.has(key)) { seen.add(key); matches.push(ClassificationSearchResultDto.create(dto)); }
        if (matches.length === 3) break;
      }
      let better: Record<string, unknown> | null = null;
      const b = root.betterModule;
      if (b && typeof b === "object" && str(b, "module")) {
        const nm = norm(str(b, "module"));
        let grp = others.filter((o) => norm(o.ModuleName) === nm);
        if (grp.length === 0) grp = others.filter((o) => { const n = norm(o.ModuleName); return n.length >= 3 && (n.includes(nm) || nm.includes(n)); });
        if (grp.length) {
          const ar = pickByName(grp, str(b, "areaOfFocus"), (x) => x.AreaOfFocusName) ?? grp[0];
          if (Number(ar.ModuleId) !== moduleId)
            better = ClassificationSearchResultDto.create({ Type: "area", ModuleId: ar.ModuleId, ModuleKey: ar.ModuleKey, ModuleName: ar.ModuleName, AreaOfFocusId: ar.AreaOfFocusId, AreaOfFocusName: ar.AreaOfFocusName });
        }
      }
      return ok({ matches, betterModule: better });
    } catch (e) {
      this.log.warn(`Could not parse Gemini classification response: ${(e as Error).message}`);
      return statusCode(502, { message: "Could not read the AI suggestion. Please try again." });
    }
  }
}
