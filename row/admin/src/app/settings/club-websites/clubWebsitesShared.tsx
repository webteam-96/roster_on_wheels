import { Badge } from "@/components/ui/badge";

export type Row = {
  id: number; clubId: number; clubName: string; clubRotaryId: string;
  districtNumber: string; subdomain: string; clientDomain: string | null;
  themeId: number | null; themeName: string | null;
  startDate: string; endDate: string; status: string;
  isPurchased?: boolean;
  reminderDays: number | null; amountPaid: number | null;
  transactionId: string | null; paymentDate: string | null;
  paymentMode: string | null; paymentProofPath: string | null;
  lastReminderSent: string | null; notes: string | null;
  daysLeft: number; createdDate: string;
  // Current-year President / Secretary contact (for the Excel export).
  presidentName?: string | null; presidentMobile?: string | null; presidentEmail?: string | null;
  secretaryName?: string | null; secretaryMobile?: string | null; secretaryEmail?: string | null;
  // Phase 4 kill-switch: 1 when club + district + zone are all active; 0 when chain is broken.
  chainActive?: number;
};

export const DOMAIN_REGEX = /^(?=.{1,253}$)(?!.*\.\.)(?!.*--)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/; // single subdomain label

// Permissive (product decision): any characters allowed, including ':' and '/'. Presence + length only.
export function validateDomain(value: string, required: boolean): string | null {
  const v = value.trim();
  if (!v) return required ? "Required." : null;
  if (v.length > 253) return "Too long (max 253 chars).";
  return null;
}

export function validateLabel(value: string, required: boolean): string | null {
  const v = value.trim();
  if (!v) return required ? "Required." : null;
  if (v.length > 253) return "Too long (max 253 chars).";
  return null;
}

// Product decision: Subdomain / Third party Domain accept ANY characters (including ':' and '/')
// and are kept exactly as typed — no stripping, no normalization. Lower-cased only (domains are
// case-insensitive and the API lower-cases on save).
export function sanitizeLabelInput(value: string): string { return (value || "").toLowerCase(); }
export function sanitizeDomainInput(value: string): string { return (value || "").toLowerCase(); }

// Given a full subdomain like "club.example.org" and parent "portal.example.org",
// return just the label "rcmumbai". If parent doesn't match the suffix (e.g. legacy/imported
// rows like "club.example.org" whose parent has since changed), fall back to taking
// just the first label so the row stays editable — saving will re-suffix with the current
// parent. Returning the full dotted value would fail label validation and lock the row.
export function splitSubdomain(full: string, parentDomain: string): string {
  const suffix = `.${parentDomain.toLowerCase()}`;
  const v = full.toLowerCase();
  if (v.endsWith(suffix)) return v.slice(0, -suffix.length);
  const dotIdx = v.indexOf(".");
  return dotIdx >= 0 ? v.slice(0, dotIdx) : v;
}

// Build a clean, always-https visit URL from a stored subdomain/domain value.
// Storage is intentionally permissive (see save-time comment above) — a value
// may already carry a "https://" prefix and/or trailing slash, or (legacy rows)
// be a bare label without the parent-domain suffix. Normalize ONLY here, at
// link-construction time, so a stray "https://" in storage never produces
// "https://https://..." and a bare label never opens a dangling host.
export function toVisitUrl(raw: string | null | undefined, parentDomain?: string): string | null {
  let host = (raw || "").trim();
  if (!host) return null;
  host = host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host) return null;
  if (parentDomain && !host.includes(".")) host = `${host}.${parentDomain.toLowerCase()}`;
  return `https://${host}`;
}

export const PAGE_SIZE = 25;
export const LIST_HEAD ="whitespace-nowrap text-[13px] font-semibold text-muted-foreground";
export const STATUS_PILL = "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold";

// Brand neutrals by default; gold and red only where someone has to act.
export function statusBadge(status: string, daysLeft: number) {
  if (status === "Expired") return <span className={`${STATUS_PILL} bg-red-100 text-red-800`}>Expired</span>;
  if (status === "ActivationFailed") return <span className={`${STATUS_PILL} bg-red-100 text-red-800`}>Activation Failed</span>;
  if (status === "Inactive") return <span className={`${STATUS_PILL} bg-muted text-muted-foreground`}>Inactive</span>;
  if (status === "Active") {
    if (daysLeft <= 7) return <span className={`${STATUS_PILL} bg-red-100 text-red-800`}>Active · {daysLeft}d</span>;
    if (daysLeft <= 30) return <span className={`${STATUS_PILL} bg-[#FFC65C] text-[#1B2C42]`}>Active · {daysLeft}d</span>;
    return <span className={`${STATUS_PILL} bg-[#CFE2F6] text-[#0B3F7A]`}>Active · {daysLeft}d</span>;
  }
  return <Badge variant="outline">{status}</Badge>;
}
