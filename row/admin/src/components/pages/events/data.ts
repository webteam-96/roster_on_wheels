export type UpcomingEvent = {
  title: string;
  /** Human date string shown on the card, e.g. "18–20 December 2026". */
  date: string;
  /** Compact date badge for the photo corner. */
  badge: { month: string; day: string };
  venue: string;
  image: string;
  description?: string;
  /** External registration / details link. Omit to hide the Register button. */
  registerUrl?: string;
};

// Upcoming events shown on /events. Seeded with the one real upcoming event
// already featured on the homepage. Add more objects below (or wire this to the
// RotaryApi backend) — cards render in array order, so keep soonest-first.
export const UPCOMING_EVENTS: UpcomingEvent[] = [];
