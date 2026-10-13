import type { EventButtonData } from "./parts";

// Real data scraped from https://club.example.org/Past-Events.aspx.
// Photos extracted from the design comp (public/images/events/*).

export type EventBadge = { month: string; day: string; year: string };
export type MahabsLink = { label: string; url: string };
export type MahabsDay = { day: string; links: MahabsLink[] };

export type EventItem = {
  title: string;
  date: string;
  badge: EventBadge;
  venue: string;
  image: string;
  /** Zones the event belongs to — drives the listing's zone filter. */
  zones: number[];
  buttons?: EventButtonData[];
  days?: MahabsDay[]; // MAHABS-style accordion card
  trf?: MahabsLink[];
};

export const EVENTS: EventItem[] = [];

/** URL slug derived from the event's image filename (e.g. "vision", "mahabs"). */
export function eventSlug(e: EventItem): string {
  return e.image.replace("/images/events/", "").replace(/(-hd)?\.jpg$/, "");
}

export function getEventBySlug(slug: string): EventItem | undefined {
  return EVENTS.find((e) => eventSlug(e) === slug);
}
