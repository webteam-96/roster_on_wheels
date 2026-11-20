import type { BureauEntry, SaveBureauEntry } from "@/types/speakerBureau";

export const blankBureauEntry = (): SaveBureauEntry => ({
  name: "", bio: null, topics: "", languages: "", email: null, phone: null, city: null, availableOnline: false, availableInPerson: true,
});

/** The form values of an entry, for editing. */
export const toBureauForm = (e: BureauEntry): SaveBureauEntry => ({
  name: e.name, bio: e.bio, topics: e.topics, languages: e.languages, email: e.email, phone: e.phone, city: e.city,
  availableOnline: e.availableOnline, availableInPerson: e.availableInPerson,
});

const orNull = (v: string | null) => v?.trim() || null;

/** Trimmed body for the API; empty optional fields become null. */
export const cleanBureauForm = (f: SaveBureauEntry): SaveBureauEntry => ({
  ...f, name: f.name.trim(), topics: f.topics.trim(), languages: f.languages.trim(),
  bio: orNull(f.bio), email: orNull(f.email), phone: orNull(f.phone), city: orNull(f.city),
});

/** "4.3 of 5 (12 ratings)", or "Not rated yet". */
export function ratingText(e: Pick<BureauEntry, "averageRating" | "ratingCount">): string {
  if (e.averageRating == null || e.ratingCount === 0) return "Not rated yet";
  return `${e.averageRating.toFixed(1)} of 5 (${e.ratingCount} ${e.ratingCount === 1 ? "rating" : "ratings"})`;
}

/** How the speaker gives talks. */
export function modeText(e: Pick<BureauEntry, "availableOnline" | "availableInPerson">): string {
  return e.availableOnline && e.availableInPerson ? "Online or in person" : e.availableOnline ? "Online" : "In person";
}

export const tagList = (s: string | null | undefined) => (s ?? "").split(",").map((t) => t.trim()).filter(Boolean);
