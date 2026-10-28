export interface AttendanceListItem {
  id: number;
  clubId: number;
  yearId: number;
  eventName: string;
  eventDateTime: string;
  meetingMode?: string;
  meetingLink?: string | null;
  membersCount: number;
  annsCount: number;
  annetsCount: number;
  visitorsCount: number;
  rotariansCount: number;
  delegatesCount: number;
}

export interface AttendanceMember {
  id: number;
  memberId: number;
  memberName: string;
}

export interface AttendanceAnn {
  id: number;
  annName: string;
}

export interface AttendanceAnnet {
  id: number;
  annetName: string;
}

export interface AttendanceVisitor {
  id: number;
  visitorName: string;
  invitedBy: string | null;
}

export interface AttendanceRotarian {
  id: number;
  rotarianName: string;
  clubName: string | null;
}

export interface AttendanceDelegate {
  id: number;
  rotarianName: string;
  districtDesignation: string | null;
  clubName: string | null;
}

export interface AttendanceDetail {
  id: number;
  clubId: number;
  yearId: number;
  eventName: string;
  description: string;
  eventDateTime: string;
  /** The club's wall-clock "YYYY-MM-DDTHH:mm", for the datetime-local input. */
  eventLocal?: string;
  meetingMode?: string;
  meetingLink?: string | null;
  members: AttendanceMember[];
  anns: AttendanceAnn[];
  annets: AttendanceAnnet[];
  visitors: AttendanceVisitor[];
  rotarians: AttendanceRotarian[];
  delegates: AttendanceDelegate[];
}

export interface CreateAttendanceRequest {
  eventName: string;
  description: string;
  eventDateTime: string;
  meetingMode?: string;
  meetingLink?: string | null;
  memberIds: number[];
  anns: { annName: string }[];
  annets: { annetName: string }[];
  visitors: { visitorName: string; invitedBy: string | null }[];
  rotarians: { rotarianName: string; clubName: string | null }[];
  delegates: { rotarianName: string; districtDesignation: string | null; clubName: string | null }[];
}

export interface UpdateAttendanceRequest {
  eventName: string;
  description: string;
  eventDateTime: string;
  meetingMode?: string;
  meetingLink?: string | null;
  memberIds: number[];
  anns: { annName: string }[];
  annets: { annetName: string }[];
  visitors: { visitorName: string; invitedBy: string | null }[];
  rotarians: { rotarianName: string; clubName: string | null }[];
  delegates: { rotarianName: string; districtDesignation: string | null; clubName: string | null }[];
}

export interface ClubMemberSimple {
  id: number;
  memberName: string;
}
