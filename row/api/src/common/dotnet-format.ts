/**
 * C# ToString(format) for dates and numbers, as the RIZones code uses them in
 * emails, documents and messages: date.ToString("dd-MMM-yyyy"),
 * amount.ToString("N2"), DateTime.Now.ToString("yyyyMMddHHmmss").
 *
 * The culture is the server's CurrentCulture in .NET. It is configurable here
 * (Globalization:Culture, default "en-US") because it decides grouping in "N2"
 * (en-US 1,234,567.00, en-IN 12,34,567.00) and month and AM/PM spellings.
 */

let culture = "en-US";
let currency = "USD";

/** Globalization:Culture and the currency "C" formats in (RegionInfo of that culture in .NET). */
export function setCulture(c: string, currencyCode?: string): void {
  culture = c || "en-US";
  if (currencyCode) currency = currencyCode;
}

export function getCulture(): string {
  return culture;
}

type DateInput = string | Date | null | undefined;

/** A .NET-style date string ("2026-09-30T14:05:00", "2026-09-30") or a Date -> wall-clock parts. */
function parts(value: DateInput): { y: number; M: number; d: number; H: number; m: number; s: number; f: number; dow: number } | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return {
      y: value.getFullYear(), M: value.getMonth() + 1, d: value.getDate(),
      H: value.getHours(), m: value.getMinutes(), s: value.getSeconds(), f: value.getMilliseconds() * 10_000, dow: value.getDay(),
    };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/.exec(value.trim());
  if (!match) return parts(new Date(value));
  const [, y, M, d, H = "0", m = "0", s = "0", frac = "0"] = match;
  const dow = new Date(Date.UTC(+y, +M - 1, +d)).getUTCDay();
  return { y: +y, M: +M, d: +d, H: +H, m: +m, s: +s, f: Number(frac.slice(0, 7).padEnd(7, "0")), dow };
}

const MONTH = (m: number, style: "short" | "long") =>
  new Intl.DateTimeFormat(culture, { month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2000, m - 1, 1)));
const DAY = (dow: number, style: "short" | "long") =>
  new Intl.DateTimeFormat(culture, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + dow)));
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// Standard format strings (en-US patterns).
const STANDARD: Record<string, string> = {
  d: "M/d/yyyy",
  D: "dddd, MMMM d, yyyy",
  f: "dddd, MMMM d, yyyy h:mm tt",
  F: "dddd, MMMM d, yyyy h:mm:ss tt",
  g: "M/d/yyyy h:mm tt",
  G: "M/d/yyyy h:mm:ss tt",
  t: "h:mm tt",
  T: "h:mm:ss tt",
  s: "yyyy-MM-ddTHH:mm:ss",
  u: "yyyy-MM-dd HH:mm:ssZ",
  M: "MMMM d",
  m: "MMMM d",
  Y: "MMMM yyyy",
  y: "MMMM yyyy",
};

/** DateTime.ToString(format). An unparseable or null value gives "". */
export function formatDate(value: DateInput, format = "G"): string {
  const p = parts(value);
  if (!p) return "";
  if (format === "o" || format === "O") return `${p.y}-${pad(p.M)}-${pad(p.d)}T${pad(p.H)}:${pad(p.m)}:${pad(p.s)}.${pad(p.f, 7)}`;
  const pattern = format.length === 1 && STANDARD[format] ? STANDARD[format] : format;

  let out = "";
  for (let i = 0; i < pattern.length; ) {
    const c = pattern[i];
    if (c === "'" || c === '"') {
      const end = pattern.indexOf(c, i + 1);
      out += pattern.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? pattern.length : end + 1;
      continue;
    }
    if (c === "\\") {
      out += pattern[i + 1] ?? "";
      i += 2;
      continue;
    }
    let n = 1;
    while (pattern[i + n] === c) n++;
    switch (c) {
      case "y": out += n === 1 ? String(p.y % 100) : n === 2 ? pad(p.y % 100) : pad(p.y, n); break;
      case "M": out += n === 1 ? String(p.M) : n === 2 ? pad(p.M) : n === 3 ? MONTH(p.M, "short") : MONTH(p.M, "long"); break;
      case "d": out += n === 1 ? String(p.d) : n === 2 ? pad(p.d) : n === 3 ? DAY(p.dow, "short") : DAY(p.dow, "long"); break;
      case "H": out += n === 1 ? String(p.H) : pad(p.H); break;
      case "h": { const h = p.H % 12 || 12; out += n === 1 ? String(h) : pad(h); break; }
      case "m": out += n === 1 ? String(p.m) : pad(p.m); break;
      case "s": out += n === 1 ? String(p.s) : pad(p.s); break;
      case "f": out += pad(p.f, 7).slice(0, n); break;
      case "F": { const v = pad(p.f, 7).slice(0, n).replace(/0+$/, ""); out += v; break; }
      case "t": { const ap = p.H < 12 ? "AM" : "PM"; out += n === 1 ? ap[0] : ap; break; }
      case "z": out += ""; break; // offsets: DateTime of kind Unspecified has none
      case "K": out += ""; break;
      default: out += c.repeat(n);
    }
    i += n;
  }
  return out;
}

/** decimal/int/double.ToString(format). Supports N, F, C, P, D, E-less custom ("0.00", "#,##0", "0.#"). */
export function formatNumber(value: number | null | undefined, format = "G"): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  const n = Number(value);
  const std = /^([NnFfCcPpDdGg])(\d*)$/.exec(format);
  if (std) {
    const kind = std[1].toUpperCase();
    const digits = std[2] === "" ? undefined : Number(std[2]);
    switch (kind) {
      case "N":
        return new Intl.NumberFormat(culture, { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 }).format(n);
      case "F":
        return n.toFixed(digits ?? 2);
      case "C":
        return new Intl.NumberFormat(culture, { style: "currency", currency, minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 }).format(n);
      case "P":
        return new Intl.NumberFormat(culture, { style: "percent", minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 }).format(n).replace("%", " %");
      case "D":
        return (n < 0 ? "-" : "") + String(Math.trunc(Math.abs(n))).padStart(digits ?? 0, "0");
      case "G":
        return String(n);
    }
  }
  // Custom: "0.00", "#,##0.00", "0.#", "#,##0"
  const [intPart, fracPart = ""] = format.split(".");
  const minFrac = (fracPart.match(/0/g) ?? []).length;
  const maxFrac = minFrac + (fracPart.match(/#/g) ?? []).length;
  const grouping = intPart.includes(",");
  const minInt = Math.max(1, (intPart.match(/0/g) ?? []).length);
  return new Intl.NumberFormat(culture, {
    useGrouping: grouping,
    minimumIntegerDigits: minInt,
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  }).format(n);
}

/** Math.Round(value, decimals): .NET's default MidpointRounding.ToEven ("banker's rounding"). */
export function dotnetRound(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  const x = value * f;
  const r = Math.round(x);
  // A tie (within float noise) goes to the even neighbour.
  return (Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r) / f;
}

/** Milliseconds until the next hour:00 on the wall clock of an IANA zone (a daily job's "run at HH:00 local"). */
export function msUntilNextHour(timeZone: string, hour: number, now = new Date()): number {
  const [, H, m, s] = /T(\d{2}):(\d{2}):(\d{2})/.exec(nowIn(timeZone, now))!.map(Number);
  let secs = hour * 3600 - (H * 3600 + m * 60 + s);
  if (secs <= 0) secs += 24 * 3600;
  return secs * 1000 - now.getMilliseconds();
}

/** DateTime.Now as wall-clock time in an IANA zone ("yyyy-MM-ddTHH:mm:ss"), for formatDate. RIZones used the server's IST clock. */
export function nowIn(timeZone: string, at = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timeZone || "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** WebUtility.HtmlEncode: < > & " ' as entities, and U+00A0–U+00FF and characters outside the BMP as numeric references. */
export function htmlEncode(s: string | null | undefined): string {
  let out = "";
  for (const ch of s ?? "") {
    const c = ch.codePointAt(0)!;
    if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === "&") out += "&amp;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&#39;";
    else if ((c >= 0xa0 && c <= 0xff) || c > 0xffff) out += `&#${c};`;
    else out += ch;
  }
  return out;
}

/**
 * decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture): optional surrounding
 * whitespace, a leading or trailing sign, "," group separators in the integer part and one "." decimal point.
 * Null when it does not parse.
 */
export function parseInvariantNumber(s: string | null | undefined): number | null {
  const m = /^\s*([+-]?)((?:\d|,(?=\d))*\d|(?=\.\d))(?:\.(\d*))?([+-]?)\s*$/.exec(s ?? "");
  if (!m || (m[1] && m[4])) return null;
  const n = Number(`${m[2].replace(/,/g, "") || "0"}.${m[3] || "0"}`);
  return (m[1] || m[4]) === "-" ? -n : n;
}
