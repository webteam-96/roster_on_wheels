import type { DbCommands } from "../database/db.service";
import type { CurrentUser } from "../auth/current-user";

/**
 * Port of MemberPrivacyHelper.cs. Members choose whether their phone and email
 * are shown to their own club and to other clubs; a member always sees their
 * own details. A missing flag means visible.
 */
export interface PrivacyFlags {
  showPhoneInMyClub: boolean;
  showPhoneInAllClubs: boolean;
  showEmailInMyClub: boolean;
  showEmailInAllClubs: boolean;
}

export const VISIBLE_FLAGS: PrivacyFlags = { showPhoneInMyClub: true, showPhoneInAllClubs: true, showEmailInMyClub: true, showEmailInAllClubs: true };

/** null (absent) counts as visible. */
export const toFlag = (raw: unknown): boolean => raw === null || raw === undefined || raw === true || (raw !== false && Number(raw) !== 0);

export function viewerMemberId(user: CurrentUser | null | undefined): number | null {
  const id = user?.intClaim("memberId") ?? null;
  return id !== null && id > 0 ? id : null;
}

function decide(viewerId: number | null, rowMemberId: number, viewerSharesClub: boolean, myClubFlag: unknown, allClubsFlag: unknown): boolean {
  if (viewerId !== null && viewerId === rowMemberId) return true;
  return toFlag(viewerSharesClub ? myClubFlag : allClubsFlag);
}

export const shouldShowPhone = (viewerId: number | null, rowMemberId: number, viewerSharesClub: boolean, inMyClub: unknown, inAllClubs: unknown) =>
  decide(viewerId, rowMemberId, viewerSharesClub, inMyClub, inAllClubs);

export const shouldShowEmail = (viewerId: number | null, rowMemberId: number, viewerSharesClub: boolean, inMyClub: unknown, inAllClubs: unknown) =>
  decide(viewerId, rowMemberId, viewerSharesClub, inMyClub, inAllClubs);

export async function getViewerClubIds(conn: DbCommands, viewerId: number | null): Promise<Set<number>> {
  if (viewerId === null) return new Set();
  const rows = await conn.query(
    `SELECT DISTINCT cm.fk_club_id AS id
     FROM club_members cm
     WHERE cm.fk_member_master_profile_id = @ViewerId
       AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0`,
    { ViewerId: viewerId },
  );
  return new Set(rows.map((r) => Number(r.id)));
}

export async function viewerSharesClub(conn: DbCommands, viewerId: number | null, clubId: number): Promise<boolean> {
  if (viewerId === null) return false;
  const count = Number(
    await conn.executeScalar(
      `SELECT COUNT(*)
       FROM club_members cm
       WHERE cm.fk_member_master_profile_id = @ViewerId
         AND cm.fk_club_id = @ClubId
         AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0`,
      { ViewerId: viewerId, ClubId: clubId },
    ),
  );
  return count > 0;
}

export async function getClubPeerMemberIds(conn: DbCommands, viewerId: number | null): Promise<Set<number>> {
  if (viewerId === null) return new Set();
  const rows = await conn.query(
    `SELECT DISTINCT peer.fk_member_master_profile_id AS id
     FROM club_members mine
     JOIN club_members peer ON peer.fk_club_id = mine.fk_club_id
          AND peer.IsActive = 1 AND COALESCE(peer.isdeleted, 0) = 0
     WHERE mine.fk_member_master_profile_id = @ViewerId
       AND mine.IsActive = 1 AND COALESCE(mine.isdeleted, 0) = 0`,
    { ViewerId: viewerId },
  );
  return new Set(rows.map((r) => Number(r.id)));
}

export async function viewerSharesClubWithMember(conn: DbCommands, viewerId: number | null, rowMemberId: number): Promise<boolean> {
  if (viewerId === null) return false;
  if (viewerId === rowMemberId) return true;
  const count = Number(
    await conn.executeScalar(
      `SELECT COUNT(*)
       FROM club_members mine
       JOIN club_members peer ON peer.fk_club_id = mine.fk_club_id
            AND peer.fk_member_master_profile_id = @RowId
            AND peer.IsActive = 1 AND COALESCE(peer.isdeleted, 0) = 0
       WHERE mine.fk_member_master_profile_id = @ViewerId
         AND mine.IsActive = 1 AND COALESCE(mine.isdeleted, 0) = 0`,
      { ViewerId: viewerId, RowId: rowMemberId },
    ),
  );
  return count > 0;
}

export async function getPrivacyFlags(conn: DbCommands, memberIds: Iterable<number>): Promise<Map<number, PrivacyFlags>> {
  const ids = [...new Set(memberIds)];
  const map = new Map<number, PrivacyFlags>();
  if (!ids.length) return map;
  const rows = await conn.query(
    `SELECT pk_member_master_profile_id AS memberId,
            ShowPhoneInMyClub   AS showPhoneInMyClub,
            ShowPhoneInAllClubs AS showPhoneInAllClubs,
            ShowEmailInMyClub   AS showEmailInMyClub,
            ShowEmailInAllClubs AS showEmailInAllClubs
     FROM member_master_profile
     WHERE pk_member_master_profile_id IN @Ids`,
    { Ids: ids },
  );
  for (const r of rows) {
    map.set(Number(r.memberId), {
      showPhoneInMyClub: toFlag(r.showPhoneInMyClub),
      showPhoneInAllClubs: toFlag(r.showPhoneInAllClubs),
      showEmailInMyClub: toFlag(r.showEmailInMyClub),
      showEmailInAllClubs: toFlag(r.showEmailInAllClubs),
    });
  }
  return map;
}

export const flagsFor = (map: Map<number, PrivacyFlags>, memberId: number) => map.get(memberId) ?? VISIBLE_FLAGS;
