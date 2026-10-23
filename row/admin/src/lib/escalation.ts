// Escalation alerts (B.1 #32). The limits match EscalationService.Validate in the API, which checks them again.
import type { EscalationEmailStatus, EscalationRule } from "@/services/api";

export const ESCALATION_FEATURE = "escalation";
export const MAX_DELAY_DAYS = 60;
export const MAX_SHORTFALL = 31;

/** A whole number from min to max typed in a box; null when the text is not one. */
export function parseWhole(text: string, min: number, max: number): number | null {
  const v = text.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

export const RULE_LABELS: Record<EscalationRule, string> = { target: "Targets", meetings: "Meetings" };

export const EMAIL_STATUS_LABELS: Record<EscalationEmailStatus, string> = {
  sent: "Email sent",
  no_email: "No email address, app only",
  no_recipient: "Nobody holds the role",
  opted_out: "Opted out of email, app only",
};
