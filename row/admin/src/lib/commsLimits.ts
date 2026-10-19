// Character limits for the four communication content types (Upcoming Events, Announcements,
// Newsletters, Documents), club AND district. They keep notification bodies short enough for email and push.
// The SAME numbers are enforced server-side (see RotaryApi CommsLimits) — keep the two in sync.
export const COMMS_LIMITS = {
  event: { title: 50, venue: 70, description: 450 },
  announcement: { title: 50, description: 520 },
  newsletter: { title: 50 },
  document: { title: 50 },
} as const;
