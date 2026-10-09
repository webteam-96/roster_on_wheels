import { InvalidOperationException } from "../common/exceptions";

/** Port of CommsLimits.cs: length limits shared by the communication modules. */
export const CommsLimits = {
  EventTitle: 50,
  EventVenue: 70,
  EventDescription: 450,
  AnnouncementTitle: 50,
  AnnouncementDescription: 520,
  NewsletterTitle: 50,
  DocumentTitle: 50,
} as const;

/** Trim and cut to `max` characters. */
export function clamp(value: string | null | undefined, max: number): string | null | undefined {
  if (!value) return value;
  const v = value.trim();
  return v.length <= max ? v : v.slice(0, max);
}

/** Throw when the trimmed value is longer than `max`. */
export function requireMax(value: string | null | undefined, max: number, fieldName: string): void {
  if (value && value.trim().length > max) throw new InvalidOperationException(`${fieldName} must be ${max} characters or fewer.`);
}
