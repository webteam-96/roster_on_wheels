// Volunteers and speakers (api/DTOs/VolunteerDtos.cs; flagged module "volunteers").

export type SheetStatus = "open" | "closed";

export interface VolunteerSheetListItem {
  id: number;
  title: string;
  status: SheetStatus;
  isPublic: boolean;
  eventTitle: string | null;
  projectId: number | null;
  slotCount: number;
  capacity: number;
  filled: number;
  firstStart: string | null;
  hours: number;
}

export interface VolunteerSignup {
  id: number;
  slotId: number;
  memberId: number | null;
  name: string;
  email: string | null;
  hours: number | null;
  reminderSentAt: string | null;
  createdDate: string;
}

export interface VolunteerSlot {
  id: number;
  task: string;
  startsAt: string;
  endsAt: string | null;
  /** The club's wall-clock "YYYY-MM-DDTHH:mm" for the form; startsAt / endsAt may be UTC ("…Z"). */
  startsLocal?: string;
  endsLocal?: string | null;
  capacity: number;
  filled: number;
  signups: VolunteerSignup[];
}

export interface VolunteerSheet {
  id: number;
  clubId: number;
  title: string;
  description: string | null;
  eventId: number | null;
  eventTitle: string | null;
  yearId: number | null;
  projectId: number | null;
  projectTitle: string | null;
  projectManHours: number | null;
  hoursApplied: number;
  totalHours: number;
  publicToken: string;
  isPublic: boolean;
  status: SheetStatus;
  slots: VolunteerSlot[];
}

export interface SaveVolunteerSlot {
  id: number | null;
  task: string;
  startsAt: string;
  endsAt: string | null;
  capacity: number;
}

export interface SaveVolunteerSheet {
  title: string;
  description: string | null;
  eventId: number | null;
  yearId: number | null;
  projectId: number | null;
  isPublic: boolean;
  status: SheetStatus;
  slots: SaveVolunteerSlot[];
}

export interface VolunteerTarget {
  id: number;
  title: string;
  date: string | null;
}

export interface VolunteerTargets {
  events: VolunteerTarget[];
  projects: VolunteerTarget[];
}

export interface PublicVolunteerSlot {
  id: number;
  task: string;
  startsAt: string;
  endsAt: string | null;
  spotsLeft: number;
}

export interface PublicVolunteerSheet {
  title: string;
  description: string | null;
  clubName: string;
  eventTitle: string | null;
  formToken: string;
  slots: PublicVolunteerSlot[];
}

export interface Speaker {
  id: number;
  meetingDate: string;
  name: string;
  topic: string | null;
  bio: string | null;
  photoPath: string | null;
  email: string | null;
  phone: string | null;
  showOnWebsite: boolean;
}

export type SaveSpeaker = Omit<Speaker, "id" | "photoPath">;

export interface MeetingDuty {
  id: number;
  clubId: number;
  clubName: string | null;
  meetingDate: string;
  duty: string;
  memberId: number;
  memberName: string | null;
  note: string | null;
  reminderSentAt: string | null;
}

export interface SaveMeetingDuty {
  meetingDate: string;
  duty: string;
  memberId: number;
  note: string | null;
}
