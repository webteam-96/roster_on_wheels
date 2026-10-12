export interface PphCamp {
  id: number;
  title: string;
  description: string | null;
  address: string | null;
  campDate: string;
  campLogoPath: string | null;
  isActive: boolean;
  attendanceCount: number;
}

export interface PphAttendance {
  id: number;
  campId: number;
  name: string;
  mobileNo: string | null;
  sex: string | null;
  address: string | null;
  age: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  bloodSugarType: string | null;
  bloodSugarValue: number | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  diabetesStatus: string | null;
  bpStatus: string | null;
  isOverweight: boolean;
  isObese: boolean;
  isConsentedForMessages: boolean;
  remarks: string | null;
}

// ── 3-level model: Attendee (person) → medical readings (many) ──

export interface PphMedicalReading {
  id: number;
  attendeeId: number;
  campId: number;
  registrationNo: string | null;
  readingDate: string;
  age: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  bloodSugarType: string | null;
  bloodSugarValue: number | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  diabetesStatus: string | null;
  bpStatus: string | null;
  isOverweight: boolean;
  isObese: boolean;
  remarks: string | null;
}

export interface PphAttendee {
  id: number;
  campId: number;
  name: string;
  mobileNo: string;
  sex: string | null;
  address: string | null;
  isConsentedForMessages: boolean;
  readingCount: number;
  latestReading: PphMedicalReading | null;
}

export interface PphAttendeeDetail {
  attendee: PphAttendee;
  history: PphMedicalReading[];
}

// ── Attendee history BY MOBILE (cross-club / cross-camp / cross-year) ──
// An "entry" = one attendee row (one camp participation). Never deduped.

export interface PphMobileHistoryEntry {
  attendeeId: number;
  campId: number;
  campTitle: string;
  campDate: string;
  attendeeName: string;
  mobileNo: string;
  sex: string | null;
  address: string | null;
  readingCount: number;
  latestReadingDate: string | null;
  yearLabel: string;
  isConsentedForMessages: boolean;
  // Every medical reading from this camp participation (newest first).
  readings: PphMedicalReading[];
}

export interface PphMobileHistoryGroup {
  clubId: number | null;
  districtId: number | null;
  groupName: string;
  isDistrict: boolean;
  entryCount: number;
  entries: PphMobileHistoryEntry[];
}

export interface PphMobileHistory {
  mobile: string;
  totalEntries: number;
  groupCount: number;
  groups: PphMobileHistoryGroup[];
}

// ── Scoped attendee REPORT row (Excel export) ──
export interface PphAttendeeReportRow {
  districtNumber: string | null;
  clubName: string;
  campId: number;
  campTitle: string;
  campDate: string;
  yearLabel: string;
  attendeeName: string;
  mobileNo: string;
  sex: string | null;
  address: string | null;
  readingCount: number;
  latestReadingDate: string | null;
}

// Add-reading payload (person + medical, all mandatory except status/remarks)
export interface CreatePphReadingPayload {
  name: string;
  mobileNo: string;
  sex: string;
  address: string;
  age: number;
  bpSystolic: number;
  bpDiastolic: number;
  bloodSugarType: string;
  bloodSugarValue: number;
  heightCm: number;
  weightKg: number;
  diabetesStatus: string | null;
  bpStatus: string | null;
  isConsentedForMessages: boolean;
  remarks: string | null;
}

export interface UpdatePphAttendeePayload {
  name: string;
  mobileNo: string;
  sex: string;
  address: string;
  isConsentedForMessages: boolean;
}

export interface UpdatePphReadingPayload {
  age: number;
  bpSystolic: number;
  bpDiastolic: number;
  bloodSugarType: string;
  bloodSugarValue: number;
  heightCm: number;
  weightKg: number;
  diabetesStatus: string | null;
  bpStatus: string | null;
  remarks: string | null;
}
