/**
 * The one formatting module for numbers, money and dates (master plan WS3).
 * New code formats through here, never through toLocaleString, toLocaleDateString
 * or Intl directly, so the instance's locale, currency and time zone apply
 * everywhere. React code uses useFormat() (hooks/useFormat.ts); other code
 * calls createFormat().
 *
 * Time values from the API come in two shapes:
 *  - "YYYY-MM-DD" (a calendar date: birthday, project date). Shown as that date
 *    in every zone, never shifted.
 *  - a timestamp. With an offset ("…+05:30", "…Z") it is converted to the
 *    district's zone. Without one ("2026-09-30T14:00:00", ROW today) it is
 *    instance time and shown as written, whatever the viewer's own clock says.
 */

export type DateStyle = "short" | "medium" | "long";

export interface Formatters {
  readonly locale: string;
  readonly currency: string;
  readonly timeZone: string;
  number(n: number | null | undefined, opts?: Intl.NumberFormatOptions): string;
  percent(fraction: number | null | undefined, digits?: number): string;
  money(amount: number | null | undefined, currency?: string | null): string;
  moneyShort(amount: number | null | undefined, currency?: string | null): string;
  /** The currency's symbol in this locale ("₹", "$", "￥", "CA$"). */
  currencySymbol(currency?: string | null): string;
  date(d: string | Date | null | undefined, style?: DateStyle): string;
  dateTime(d: string | Date | null | undefined): string;
  time(d: string | Date | null | undefined): string;
  monthName(month1to12: number, style?: "short" | "long"): string;
  weekdayName(day0to6: number, style?: "short" | "long"): string;
  relative(d: string | Date | null | undefined): string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** "YYYY-MM-DD" -> local-midnight Date, never shifted by a zone. */
export function parseDateOnly(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Normalise to a Date plus the zone to format it in. Calendar dates and
 * offset-less timestamps are rebuilt as UTC wall-clock values and formatted in
 * UTC, which prints exactly what was written.
 */
function toInstant(value: string | Date, timeZone: string): { date: Date; zone: string } | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : { date: value, zone: timeZone };
  const s = value.trim();
  if (!s) return null;
  if (DATE_ONLY.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return { date: new Date(Date.UTC(y, m - 1, d)), zone: "UTC" };
  }
  if (HAS_OFFSET.test(s)) {
    const date = new Date(s);
    return isNaN(date.getTime()) ? null : { date, zone: timeZone };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(s);
  if (!m) {
    const date = new Date(s);
    return isNaN(date.getTime()) ? null : { date, zone: timeZone };
  }
  const [, y, mo, d, h, mi, sec = "0", frac = "0"] = m;
  const ms = Number(frac.slice(0, 3).padEnd(3, "0"));
  return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, ms)), zone: "UTC" };
}

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "2-digit", month: "2-digit", year: "numeric" },
  medium: { day: "2-digit", month: "short", year: "numeric" }, // "01 Aug 2026", today's common style
  long: { day: "numeric", month: "long", year: "numeric" },
};

// Indian grouping suffixes for compact money, used only when the number locale is en-IN.
const INDIAN_UNITS: ReadonlyArray<[number, string]> = [
  [1_00_00_000, "Cr"],
  [1_00_000, "L"],
  [1_000, "K"],
];

/**
 * @param locale    number/date locale (for English interfaces this is the brand's
 *                  numberLocale, e.g. "en-IN"; otherwise the interface language)
 * @param currency  default ISO 4217 code
 * @param timeZone  IANA zone that timestamps with an offset are shown in
 */
export function createFormat(locale: string, currency: string, timeZone: string): Formatters {
  const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
  const nf = (opts: Intl.NumberFormatOptions) => {
    const key = `n${JSON.stringify(opts)}`;
    let f = cache.get(key) as Intl.NumberFormat | undefined;
    if (!f) cache.set(key, (f = new Intl.NumberFormat(locale, opts)));
    return f;
  };
  const df = (opts: Intl.DateTimeFormatOptions) => {
    const key = `d${JSON.stringify(opts)}`;
    let f = cache.get(key) as Intl.DateTimeFormat | undefined;
    if (!f) cache.set(key, (f = new Intl.DateTimeFormat(locale, opts)));
    return f;
  };
  const code = (c?: string | null) => (c || currency).toUpperCase();
  const num = (n: number | null | undefined) => (Number.isFinite(Number(n)) ? Number(n) : 0);
  const formatInstant = (d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions) => {
    if (d == null) return "";
    const instant = toInstant(d, timeZone);
    return instant ? df({ ...opts, timeZone: instant.zone }).format(instant.date) : "";
  };

  const self: Formatters = {
    locale,
    currency,
    timeZone,

    number: (n, opts) => nf(opts ?? {}).format(num(n)),

    percent: (fraction, digits = 0) =>
      nf({ style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(num(fraction)),

    // Whole amounts print without decimals ("₹1,05,000", "$105"), as the app does today;
    // others use the currency's own minor units (yen and won have none).
    money: (amount, c) => {
      const n = num(amount);
      const opts: Intl.NumberFormatOptions = { style: "currency", currency: code(c) };
      if (Number.isInteger(n)) opts.minimumFractionDigits = 0;
      return nf(opts).format(n);
    },

    moneyShort: (amount, c) => {
      const n = num(amount);
      const cur = code(c);
      if (locale.toLowerCase() === "en-in") {
        const sym = self.currencySymbol(cur);
        const sep = sym.length > 1 ? " " : "";
        const unit = INDIAN_UNITS.find(([size]) => Math.abs(n) >= size);
        return unit ? `${sym}${sep}${(n / unit[0]).toFixed(1)}${unit[1]}` : `${sym}${sep}${Math.round(n)}`;
      }
      return nf({ style: "currency", currency: cur, notation: "compact", maximumFractionDigits: 1 }).format(n);
    },

    currencySymbol: (c) =>
      nf({ style: "currency", currency: code(c) })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? code(c),

    date: (d, style = "medium") => formatInstant(d, DATE_STYLES[style]),

    dateTime: (d) => formatInstant(d, { ...DATE_STYLES.medium, hour: "numeric", minute: "2-digit" }),

    time: (d) => formatInstant(d, { hour: "numeric", minute: "2-digit" }),

    monthName: (month, style = "long") =>
      df({ month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2000, month - 1, 1))),

    // 2023-01-01 was a Sunday, so day 0 = Sunday as in Date.getDay().
    weekdayName: (day, style = "long") =>
      df({ weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + day))),

    relative: (d) => {
      if (d == null) return "";
      const instant = toInstant(d, timeZone);
      if (!instant) return "";
      const seconds = Math.round((instant.date.getTime() - Date.now()) / 1000);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const steps: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
        ["year", 31_536_000],
        ["month", 2_592_000],
        ["week", 604_800],
        ["day", 86_400],
        ["hour", 3_600],
        ["minute", 60],
      ];
      for (const [unit, size] of steps) {
        if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
      }
      return rtf.format(seconds, "second");
    },
  };
  return self;
}

/** Today's date ("YYYY-MM-DD") in a zone. Use instead of new Date().toISOString().slice(0, 10), which is the UTC date. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Rotary year of a date: July to June, labelled "2026-27". */
export function rotaryYearOf(date: string | Date): string {
  const d = typeof date === "string" ? (DATE_ONLY.test(date.slice(0, 10)) ? parseDateOnly(date) : new Date(date)) : date;
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * The locale numbers and dates use: the brand's number locale while the
 * interface is in English (ROW keeps en-IN grouping, 1,00,000), otherwise
 * the interface language.
 */
export function numberLocaleFor(interfaceLocale: string, brandNumberLocale: string): string {
  return interfaceLocale.split("-")[0] === "en" ? brandNumberLocale : interfaceLocale;
}
