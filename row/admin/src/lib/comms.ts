// N5 Communication: small rules shared by the settings page, the campaign card and the compose pages.
// The server checks the same rules (api/Services/CommsService.cs); these only give early feedback.

/** Template keys the platform sends by itself; any other key is a campaign template picked in compose. */
export const SYSTEM_TEMPLATES: { key: string; label: string; placeholders: string }[] = [
  { key: "birthday", label: "Birthday greeting", placeholders: "{{member_name}}, {{club_name}}, {{foundation_link}}" },
  { key: "anniversary", label: "Anniversary greeting", placeholders: "{{member_name}}, {{club_name}}, {{foundation_link}}" },
  { key: "meeting_reminder", label: "Meeting reminder", placeholders: "{{member_name}}, {{club_name}}, {{meeting_title}}, {{meeting_time}}, {{join_link}}" },
];

export const CAMPAIGN_PLACEHOLDERS = "{{member_name}}, {{club_name}}";

export const isTemplateKey = (key: string) => /^[a-z0-9][a-z0-9_-]{0,49}$/.test(key);

export const isLanguageCode = (code: string) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(code);

/** The district's Foundation giving link: a full https:// address of at most 500 characters, with no spaces, quotes,
 *  angle brackets or sign-in part (CommsService.IsGivingUrl). Empty means no link and is checked by the caller. */
export function isGivingUrl(url: string): boolean {
  if (url.length > 500 || /[\s"'<>\\]/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** "40%" of a whole; "0%" when there is nothing to count. */
export function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
}

/** One word for a recipient row: what happened to the message after it left. */
export function deliveryLabel(status: string, deliveryStatus: string | null, opens: number, clicks: number): string {
  if (status === "Skipped") return "Skipped";
  if (status === "Failed") return "Failed";
  if (status !== "Sent") return status;
  if (deliveryStatus === "Complaint") return "Spam complaint";
  if (deliveryStatus === "Bounced") return "Bounced";
  if (clicks > 0) return "Clicked";
  if (opens > 0) return "Opened";
  if (deliveryStatus === "Delivered") return "Delivered";
  if (deliveryStatus === "Deferred") return "Delayed";
  return "Sent";
}

/** The month as YYYY-MM in UTC, the month the allowance is counted in. */
export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
