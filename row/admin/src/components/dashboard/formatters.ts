export const fmtInt = (n: number | null | undefined): string =>
  (n ?? 0).toLocaleString("en-IN");

export const fmtInr = (n: number | null | undefined): string => {
  if (n == null) return "₹0";
  return "₹" + Math.round(n).toLocaleString("en-IN");
};

export const fmtInrShort = (n: number | null | undefined): string => {
  if (!n) return "₹0";
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
};

// USD formatters — TRF / Foundation amounts are stored and shown in USD (no conversion).
export const fmtUsd = (n: number | null | undefined): string => {
  if (n == null) return "$0";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

export const fmtUsdShort = (n: number | null | undefined): string => {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

export const fmtDate = (s?: string | null): string => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return s;
  }
};

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
