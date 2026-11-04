// Event times on the public site (build spec 3.3): shown in the club's zone, plus the visitor's own time when their
// zone differs. API times without an offset are the club's wall-clock; with one ("Z") they are instants.

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

function zoneOffsetMs(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant of an API time; null when it cannot be read or the zone is unknown. */
export function eventInstant(iso: string, zone: string): Date | null {
  try {
    if (HAS_OFFSET.test(iso.trim())) {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? null : d;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso.trim());
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
    const first = wall - zoneOffsetMs(new Date(wall), zone);
    return new Date(wall - zoneOffsetMs(new Date(first), zone));
  } catch {
    return null; // unknown zone id
  }
}

/** "7:00 PM EDT", and the visitor's "11:00 PM" when their zone's offset differs at that moment (else null). */
export function eventTimeParts(iso: string, zone: string, locale: string, viewerZone: string): { shown: string; mine: string | null } | null {
  const at = eventInstant(iso, zone);
  if (!at) return null;
  const shown = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: zone, timeZoneName: "short" }).format(at);
  if (zoneOffsetMs(at, viewerZone) === zoneOffsetMs(at, zone)) return { shown, mine: null };
  const day = (z: string) => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const opts: Intl.DateTimeFormatOptions = day(zone) === day(viewerZone)
    ? { hour: "numeric", minute: "2-digit", timeZone: viewerZone }
    : { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: viewerZone };
  return { shown, mine: new Intl.DateTimeFormat(locale, opts).format(at) };
}

/** Short name of `zone` ("EDT", "BST") at the moment a wall-clock time in that zone happens; "" when unknown.
 *  `d` carries the wall-clock time in its local fields (as `new Date("2026-11-02T18:30:00")` does). */
export function zoneLabelAt(d: Date, zone: string): string {
  if (!zone || Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
  const at = eventInstant(iso, zone);
  if (!at) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
