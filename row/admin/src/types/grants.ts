// Grants module (api/Services/GrantService.cs). Dates arrive as ISO strings; date-only fields as "YYYY-MM-DDT00:00:00".

export type GrantStatus =
  | "draft"
  | "submitted"
  | "information_requested"
  | "information_provided"
  | "adjustment_requested"
  | "approved"
  | "rejected"
  | "paid"
  | "report_submitted"
  | "report_accepted"
  | "closed"
  | "cancelled";

export interface GrantCycle {
  id: number;
  districtId: number;
  yearId: number;
  yearLabel: string;
  status: "draft" | "open" | "closed";
  ddfBudget: number;
  maxRequest: number | null;
  minQualifiedMembers: number;
  opensOn: string | null;
  closesOn: string | null;
  reportDueOn: string | null;
  interimDueOn: string | null;
  rules: string | null;
  committed: number;
  paid: number;
  statusCounts: Partial<Record<GrantStatus, number>>;
}

export interface SaveGrantCycle {
  yearId: number;
  status: GrantCycle["status"];
  ddfBudget: number;
  maxRequest: number | null;
  minQualifiedMembers: number;
  opensOn: string | null;
  closesOn: string | null;
  reportDueOn: string | null;
  interimDueOn: string | null;
  rules: string | null;
}

export interface GrantApplicationListItem {
  id: number;
  cycleId: number;
  yearLabel: string;
  clubId: number;
  clubName: string;
  title: string;
  status: GrantStatus;
  amountRequested: number;
  amountApproved: number | null;
  paid: number;
  submittedAt: string | null;
  updatedAt: string;
}

export interface GrantLine {
  id?: number; // read only: the final report's actuals refer to it
  kind: "income" | "expense" | "partner";
  description: string;
  detail: string | null;
  amount: number | null;
  category?: string | null;
  supplier?: string | null;
  actualAmount?: number | null; // read only, from the final report
  variance?: number | null; // read only: actual minus budget
}

export type GrantAttachmentKind = "application" | "interim" | "receipt" | "report";

export interface GrantSignOff {
  action: "submit" | "approve";
  signerRole: string;
  signatureName: string;
  memberName: string | null;
  signedAtUtc: string;
}

export interface GrantInterimReport {
  id: number;
  progress: string;
  amountSpent: number;
  submittedByName: string | null;
  submittedAtUtc: string;
}

export interface GrantYearSummary {
  cycleId: number;
  yearId: number;
  yearLabel: string;
  budget: number;
  approved: number;
  paid: number;
  reportedSpent: number;
  outstanding: number;
}

export interface GrantMember {
  memberId: number;
  memberName?: string | null;
  note: string | null;
}

export interface GrantAttachment {
  id: number;
  kind: GrantAttachmentKind;
  originalName: string;
  sizeBytes: number;
  uploadedByName?: string | null;
  createdDate: string;
}

export interface GrantEvent {
  id: number;
  side: "club" | "district";
  action: string;
  fromStatus: GrantStatus | null;
  toStatus: GrantStatus | null;
  comment: string | null;
  memberName: string | null;
  createdDate: string;
}

export interface GrantPayment {
  id: number;
  amount: number;
  paidOn: string;
  method: string;
  reference: string | null;
  note: string | null;
  recordedByName: string | null;
}

export interface GrantActionInfo {
  action: string;
  to: GrantStatus;
  commentRequired: boolean;
}

export interface GrantApplication extends GrantApplicationListItem {
  districtId: number;
  description: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  beneficiaries: number | null;
  rulesAccepted: boolean;
  rejectionReason: string | null;
  reportSummary: string | null;
  reportAmountSpent: number | null;
  reportBeneficiaries: number | null;
  reportSubmittedAt: string | null;
  closedAt: string | null;
  reportAcceptedAt: string | null;
  createdByName: string | null;
  budgetTotal: number;
  signOffs: GrantSignOff[];
  interimReports: GrantInterimReport[];
  canSubmitInterimReport: boolean;
  attachmentKinds: GrantAttachmentKind[];
  qualificationWarning: string | null;
  qualificationRequired: boolean;
  cycle: GrantCycle;
  lines: GrantLine[];
  members: GrantMember[];
  attachments: GrantAttachment[];
  events: GrantEvent[];
  payments: GrantPayment[];
  actions: GrantActionInfo[];
  editable: boolean;
  attachmentKind: "application" | "report" | null;
  canRecordPayment: boolean;
}

export interface SaveGrantApplication {
  cycleId: number;
  title: string;
  description: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  beneficiaries: number | null;
  amountRequested: number;
  rulesAccepted: boolean;
  lines: GrantLine[];
  members: GrantMember[];
}

export interface GrantActionBody {
  comment?: string | null;
  amount?: number | null;
  reportSummary?: string | null;
  reportAmountSpent?: number | null;
  reportBeneficiaries?: number | null;
  signature?: string | null;
  lineActuals?: { lineId: number; amount: number }[] | null;
}

export interface RecordGrantPayment {
  amount: number;
  paidOn: string;
  method: string;
  reference: string | null;
  note: string | null;
}

export interface GrantCashFlow {
  budget: number;
  committed: number;
  paid: number;
  rows: { paidOn: string; clubName: string; title: string; amount: number; method: string; reference: string | null; cumulativePaid: number; balance: number }[];
}

export interface GrantClubOverview {
  lightMode: boolean;
  cycles: GrantCycle[];
  applications: GrantApplicationListItem[];
  qualifications: GrantClubQualification[];
  requireQualification: boolean;
}

export interface GrantLightProject {
  projectId: number;
  title: string;
  projectDate: string | null;
  grantAmount: number | null;
  reportDate: string | null;
}

// Grants extras: club qualification, monthly cash flow with receipts, email templates.
export interface GrantQualifiedMember {
  memberId: number;
  memberName?: string | null;
  trainedOn: string | null;
}

export interface GrantClubQualification {
  clubId: number;
  clubName: string;
  yearId: number;
  yearLabel: string;
  mouSignedOn: string | null;
  trainingOn: string | null;
  expiresOn: string | null;
  note: string | null;
  modifiedAtUtc: string | null;
  qualified: boolean;
  problem: string | null;
  members: GrantQualifiedMember[];
}

export interface SaveGrantQualification {
  mouSignedOn: string | null;
  trainingOn: string | null;
  expiresOn: string | null;
  note: string | null;
  members: GrantQualifiedMember[];
}

export interface GrantReceipt {
  id: number;
  amount: number;
  receivedOn: string;
  source: string;
  reference: string | null;
  recordedByName: string | null;
}

export interface GrantMonthlyCashFlow {
  cycleId: number;
  yearLabel: string;
  ddfBudget: number;
  approved: number;
  paidOut: number;
  receipts: number;
  balance: number;
  months: { month: string; approved: number; paidOut: number; receipts: number; balance: number }[];
  receiptList: GrantReceipt[];
}

export interface GrantEmailTemplate {
  kind: "status" | "reminder";
  subject: string;
  body: string;
  isDefault: boolean;
}
