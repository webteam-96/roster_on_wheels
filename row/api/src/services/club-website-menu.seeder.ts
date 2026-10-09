import type { DbCommands } from "../database/db.service";

/** 8 default top-level tabs. Club Service is not one: that avenue lives under Projects. */
const DEFAULT_MENUS: [string, string][] = [
  ["Home", "home"], ["About", "about"], ["Directory", "directory"], ["Directors", "directors"],
  ["Calendar", "calendar"], ["Events", "events"], ["Projects", "projects"], ["Past Presidents", "past-presidents"],
];

/** The six system-managed avenue sub-menus under "Projects" (link_value = avenue key). */
export const PROJECTS_SUB_MENUS: [string, string][] = [
  ["Community Service", "community_service"], ["Club Service", "club_service"], ["Vocational Service", "vocational_service"],
  ["New Generation Service", "new_generation_service"], ["International Service", "international_service"], ["Public Image Initiative", "public_image_initiative"],
];

/**
 * Port of ClubWebsiteMenuSeeder.SeedDefaultMenusAsync: idempotent. When the
 * canonical set is absent, legacy default menus are retired first so tabs
 * never duplicate; custom (is_default = 0) menus are untouched.
 */
export async function seedDefaultClubMenus(conn: DbCommands, clubId: number, userId: number) {
  const canonical = Number(
    await conn.executeScalar(
      `SELECT COUNT(*) FROM club_website_menu
       WHERE fk_club_id = @ClubId AND is_default = 1 AND isdeleted = 0
         AND link_value IN ('home','about','directory','directors','calendar','events','projects','past-presidents')`,
      { ClubId: clubId },
    ),
  );
  if (canonical > 0) return;
  await conn.execute(
    `UPDATE club_website_submenu s
     JOIN club_website_menu m ON m.pk_club_website_menu_id = s.fk_menu_id
     SET s.isdeleted = 1
     WHERE m.fk_club_id = @ClubId AND m.is_default = 1 AND m.isdeleted = 0 AND s.isdeleted = 0`,
    { ClubId: clubId },
  );
  await conn.execute("UPDATE club_website_menu SET isdeleted = 1 WHERE fk_club_id = @ClubId AND is_default = 1 AND isdeleted = 0", { ClubId: clubId });
  let projectsMenuId: number | null = null;
  for (let i = 0; i < DEFAULT_MENUS.length; i++) {
    const [name, linkValue] = DEFAULT_MENUS[i];
    await conn.execute(
      `INSERT INTO club_website_menu (fk_club_id, menu_name, link_type, link_value, sort_order, is_active, is_default, created_by, isdeleted)
       VALUES (@ClubId, @Name, 'page', @LinkValue, @Sort, 1, 1, @UserId, 0)`,
      { ClubId: clubId, Name: name, LinkValue: linkValue, Sort: i + 1, UserId: userId },
    );
    if (linkValue === "projects") projectsMenuId = Number(await conn.executeScalar("SELECT LAST_INSERT_ID()"));
  }
  if (projectsMenuId !== null) await seedProjectsSubMenus(conn, projectsMenuId, userId);
}

/** Keyed on the avenue link_value regardless of isdeleted: renames don't duplicate, deletes aren't resurrected. */
export async function seedProjectsSubMenus(conn: DbCommands, projectsMenuId: number, userId: number) {
  for (let i = 0; i < PROJECTS_SUB_MENUS.length; i++) {
    const [name, key] = PROJECTS_SUB_MENUS[i];
    const existing = Number(await conn.executeScalar("SELECT COUNT(*) FROM club_website_submenu WHERE fk_menu_id = @MenuId AND link_value = @Key", { MenuId: projectsMenuId, Key: key }));
    if (existing > 0) continue;
    await conn.execute(
      `INSERT INTO club_website_submenu (fk_menu_id, submenu_name, link_type, link_value, sort_order, is_active, is_system_managed, created_by, isdeleted)
       VALUES (@MenuId, @Name, 'page', @Key, @Sort, 1, 1, @UserId, 0)`,
      { MenuId: projectsMenuId, Name: name, Key: key, Sort: i + 1, UserId: userId },
    );
  }
}
