import { appFormat } from "@/lib/appFormat";

// Dashboard formatters, following the instance's locale and currency (lib/appFormat).
export const fmtInt = (n: number | null | undefined): string => appFormat().number(n ?? 0);

/** Whole-number money in the instance currency (kept under its old name for existing callers). */
export const fmtInr = (n: number | null | undefined): string => appFormat().money(Math.round(n ?? 0));

export const fmtInrShort = (n: number | null | undefined): string => appFormat().moneyShort(n ?? 0);

// TRF / Foundation amounts are stored and shown in USD (no conversion).
export const fmtUsd = (n: number | null | undefined): string => appFormat().money(n ?? 0, "USD");

export const fmtUsdShort = (n: number | null | undefined): string => appFormat().moneyShort(n ?? 0, "USD");

export const fmtDate = (s?: string | null): string => (s ? appFormat().date(s) || s : "—");

export const truncate = (s: string, n = 14): string =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

// Brand colours from the design repo
export const ROTARY_BLUE = "#003DA5";
export const ROTARY_GOLD = "#F7A81B";
export const ROTARY_TEAL = "#00A9CE";
export const POLIO_PURPLE = "#7C3AED";
export const ROTARY_GREEN = "#059669";

export const CLUB_PALETTE = [
  "#003DA5",
  "#F7A81B",
  "#10B981",
  "#EF4444",
  "#7C3AED",
  "#0EA5E9",
  "#F59E0B",
  "#EC4899",
];
