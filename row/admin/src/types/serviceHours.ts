// Service hours and contributions (api/DTOs/ServiceHoursDtos.cs; flagged module "service_hours").

export type ServiceHoursStatus = "pending" | "approved" | "rejected";

export interface ServiceHoursEntry {
  id: number;
  source: "logged" | "volunteer";
  memberId: number;
  memberName: string;
  clubId: number;
  clubName: string;
  yearId: number;
  projectId: number | null;
  projectTitle: string | null;
  otherService: string | null;
  serviceDate: string;
  hours: number;
  note: string | null;
  photoPath: string | null;
  status: ServiceHoursStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ServiceProjectOption {
  id: number;
  title: string;
  date: string | null;
  currency: string | null;
}

export interface Money {
  currency: string;
  amount: number;
}

export interface Contribution {
  id: number;
  yearId: number;
  projectId: number;
  projectTitle: string | null;
  kind: "cash" | "in_kind";
  amount: number;
  currency: string | null;
  contributor: string | null;
  description: string | null;
  contributionDate: string;
}

export interface SaveContribution {
  projectId: number;
  yearId: number;
  kind: "cash" | "in_kind";
  amount: number;
  contributor: string | null;
  description: string | null;
  contributionDate: string;
}

export interface ServiceProjectRow {
  projectId: number | null;
  title: string;
  projectManHours: number | null;
  hours: number;
  volunteerHours: number;
  members: number;
  cash: Money[];
  inKind: Money[];
}

export interface ServiceMemberRow {
  memberId: number;
  name: string;
  hours: number;
  volunteerHours: number;
  entries: number;
}

export interface ServiceClubRow {
  clubId: number;
  clubName: string;
  hours: number;
  volunteerHours: number;
  members: number;
  cash: Money[];
  inKind: Money[];
}

export interface ServiceReport {
  yearId: number;
  yearLabel: string;
  scopeName: string;
  years: { id: number; label: string }[];
  byProject: ServiceProjectRow[];
  byMember: ServiceMemberRow[];
  byClub: ServiceClubRow[];
  totals: { hours: number; volunteerHours: number; members: number; pendingEntries: number; cash: Money[]; inKind: Money[] };
}
