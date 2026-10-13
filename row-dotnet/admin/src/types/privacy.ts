// Member data export and erasure requests (master plan WS7-02, WS7-03; Appendix B.13).

export type PrivacyRequestKind = "export" | "erase";
export type PrivacyRequestStatus = "pending" | "awaiting_approval" | "processing" | "completed" | "rejected" | "failed";

export interface PrivacyRequest {
  id: number;
  kind: PrivacyRequestKind;
  status: PrivacyRequestStatus;
  memberId: number;
  memberName: string;
  clubName: string | null;
  reason: string | null;
  requestedBy: string;
  requestedAt: string;
  /** Second District Admin who approved an erasure; null until approved. */
  approvedBy: string | null;
  completedAt: string | null;
  /** Export download link, valid seven days after completion. */
  downloadUrl: string | null;
  downloadExpiresAt: string | null;
}

export interface ConsentStatus {
  required: boolean;
  policyVersion: string;
  acceptedVersion: string | null;
}
