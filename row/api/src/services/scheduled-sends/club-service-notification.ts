import type { DbCommands } from "../../database/db.service";
import { formatNumber } from "../../common/dotnet-format";

/**
 * Port of ClubServiceNotification.cs: Club Service rows (module key club_service)
 * are meetings, so the scheduled email shows the meeting fields (type, attendance,
 * agenda, minutes, primary photo) instead of the project ones. Loaded per row with
 * SELECT *, because not every year table has every column.
 */
export interface MeetingInfo {
  description: string | null;
  meetingType: string;
  attendance: string;
  agendaDocument: string | null;
  minutesDocument: string | null;
  primaryPhotoPath: string | null;
}

export const isClubService = (moduleKey: string | null | undefined) => (moduleKey ?? "").toLowerCase() === "club_service";

const MEETING_TYPES: Record<string, string> = { "": "-", regular: "Regular", fellowship: "Fellowship", bod: "BOD", assembly: "Assembly", trust: "Trust" };

/** The add/edit form's meeting type key as its label. */
export function meetingTypeLabel(raw: string | null | undefined): string {
  const key = (raw ?? "").trim().toLowerCase();
  return MEETING_TYPES[key] ?? (raw ?? "").trim();
}

/** "25 (78.13%)": the attendance count and percentage. */
export function attendanceText(attendance: number | null, percentage: number | null): string {
  if (attendance === null) return "-";
  return percentage !== null ? `${attendance} (${formatNumber(percentage, "0.##")}%)` : String(attendance);
}

export async function loadClubServiceMeeting(conn: DbCommands, projectsTable: string, photosTable: string, yearLabel: string, projectId: number): Promise<MeetingInfo | null> {
  const row = await conn.queryFirstOrDefault(`SELECT * FROM \`${projectsTable}\` WHERE pk_project_id = @Id`, { Id: projectId });
  if (!row) return null;
  const str = (col: string) => (row[col] === null || row[col] === undefined ? null : String(row[col]));
  const int = (col: string) => (row[col] === null || row[col] === undefined ? null : Math.round(Number(row[col])));
  const dec = (col: string) => (row[col] === null || row[col] === undefined ? null : Number(row[col]));

  // The primary photo, in the served-path shape the project screens use (file name only in the DB).
  let photoPath: string | null = null;
  const image = await conn.executeScalar<string>(
    `SELECT image_path FROM \`${photosTable}\`
     WHERE fk_project_id = @Id AND image_path IS NOT NULL AND image_path <> ''
     ORDER BY is_primary DESC, sort_order LIMIT 1`,
    { Id: projectId },
  );
  if (image && image.trim()) {
    if (image.startsWith("/") || image.startsWith("http")) photoPath = image;
    else {
      const oldPk = int("old_pk");
      const album = oldPk !== null ? `Album${oldPk}` : `${yearLabel.replace(/-/g, "_")}/Album${projectId}`;
      photoPath = `/Documents/gallery/Group${int("fk_club_id") ?? 0}/${album}/${image}`;
    }
  }
  return {
    description: str("description"),
    meetingType: meetingTypeLabel(str("meeting_type")),
    attendance: attendanceText(int("attendance"), dec("attendance_percentage")),
    agendaDocument: str("agenda_document"),
    minutesDocument: str("minutes_document"),
    primaryPhotoPath: photoPath,
  };
}
