import { appFormat } from "@/lib/appFormat";

// Dashboard formatters, following the instance's locale and currency (lib/appFormat).
export const fmtInt = (n: number | null | undefined): string => appFormat().number(n ?? 0);

/** Whole-number money in the instance currency (kept under its old name for existing callers). */
export const fmtInr = (n: number | null | undefined): string => appFormat().money(Math.round(n ?? 0));

export const fmtInrShort = (n: number | null | undefined): string => appFormat().moneyShort(n ?? 0);

// TRF / Foundation amounts are stored and shown in USD (no conversion).
export const fmtUsd = (n: number | null | undefined): string => appFormat().money(n ?? 0, "USD");

export const fmtUsdShort = (n: number | null | undefined): string => appFormat().moneyShort(n ?? 0, "USD");

export const fmtDate = (s?: string | null): string => (s ? appFormat().date(s) || s : "–");

export const truncate = (s: string, n = 14): string =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

// Brand colours from the design repo
export const ROTARY_BLUE = "#17458F";
export const ROTARY_GOLD = "#F7A81B";
export const ROTARY_TEAL = "#0067C8";
export const POLIO_PURPLE = "#2A3F5C"; // Fellowship ink-2: the palette has no purple
export const ROTARY_GREEN = "#059669";

export const CLUB_PALETTE = [
  "#17458F",
  "#F7A81B",
  "#10B981",
  "#EF4444",
  "#0067C8",
  "#A9C6EA",
  "#2A3F5C",
  "#FFC65C",
];
