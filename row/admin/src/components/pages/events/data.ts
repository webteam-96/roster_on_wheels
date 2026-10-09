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
export const UPCOMING_EVENTS: UpcomingEvent[] = [
  {
    title: "Sri Lanka Rotary Institute 2026",
    date: "18–20 December 2026",
    badge: { month: "DEC", day: "18–20" },
    venue: "City of Dreams, Justice Akbar Mawatha, Colombo, Sri Lanka",
    image: "/images/event-colombo-hd.jpg",
    description:
      "The zones gather in Colombo for three days of learning, fellowship and inspiration at the annual Rotary Institute.",
    registerUrl: "https://events.rotaryindia.org/",
  },
  // Template — copy this block for each new event and fill it in:
  // {
  //   title: "Event name",
  //   date: "1–2 April 2026",
  //   badge: { month: "APR", day: "1–2" },
  //   venue: "Venue, City",
  //   image: "/images/event-city.jpg",
  //   description: "One line about the event.",
  //   registerUrl: "https://…",
  // },
];
