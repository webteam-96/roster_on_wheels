export interface MonthlyReportListItem {
  reportId: number | null;
  month: number;
  monthName: string;
  isCreated: boolean;
  createdDate: string | null;
  modifiedDate: string | null;
  isUploadedToDistrict: boolean;
}

export interface MonthlyReportDetail {
  reportId: number;
  clubId: number;
  yearId: number;
  reportMonth: number;
  memberCountLastMonth: number;
  membersDeleted: number;
  membersAdded: number;
  currentMemberCount: number;
  additionalRemarks: string | null;
  isUploadedToDistrict: boolean;
  assistantGovernor: string | null;
  createdDate: string | null;
  modifiedDate: string | null;
  trfEntries: TrfEntry[];
}

export interface TrfEntry {
  trfId: number;
  trfDate: string;
  donorName: string;
  amountUSD: number;
  fundType: string;
  otherFundName: string | null;
}

export interface SaveTrfEntry {
  trfId?: number | null;
  trfDate: string;
  donorName: string;
  amountUSD: number;
  fundType: string;
  otherFundName?: string | null;
}

export interface SaveMemberInfo {
  memberCountLastMonth: number;
  membersDeleted: number;
  membersAdded: number;
  additionalRemarks: string | null;
}

export interface ReportMeeting {
  projectId: number;
  title: string;
  meetingType: string | null;
  projectDate: string | null;
  attendance: number | null;
  attendancePercentage: number | null;
}

export interface ReportProject {
  projectId: number;
  title: string;
  projectType: string | null;
  parentProjectId: number | null;
  projectDate: string | null;
  areaOfFocusName: string | null;
  projectCost: number | null;
  directBeneficiaries: number | null;
  manHours: number | null;
  rotariansInvolved: number | null;
  rotaractorsInvolved: number | null;
  rccInvolved: number | null;
}

export interface MonthlyReportPreview {
  reportId: number;
  clubId: number;
  clubName: string;
  clubCode: string | null;
  yearId: number;
  yearLabel: string;
  reportMonth: number;
  monthName: string;
  reportDate: string | null;
  preparedBy: string | null;
  designation: string | null;
  assistantGovernor: string | null;
  memberCountLastMonth: number;
  membersDeleted: number;
  membersAdded: number;
  currentMemberCount: number;
  totalMeetings: number;
  averageAttendance: number;
  trfCurrentMonth: number;
  trfThisYear: number;
  additionalRemarks: string | null;
  isUploadedToDistrict: boolean;
  uploadedToDistrictDate: string | null;
  meetings: ReportMeeting[];
  trfEntries: TrfEntry[];
  projects: Record<string, ReportProject[]>;
}

export interface ReportYear {
  id: number;
  yearLabel: string;
  isCurrent: boolean;
}
