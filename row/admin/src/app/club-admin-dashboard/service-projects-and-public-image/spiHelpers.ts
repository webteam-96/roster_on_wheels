import { Coins, DollarSign } from "@/components/icons";
import { shortMoney, moneyIconName } from "@/lib/currency";
import { defaultCurrency } from "@/lib/appFormat";

// Base URL the RI Flow-Bot export uses to build absolute photo URLs for the extension.
export const SYNC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Tab order matches the on-screen pill bar in the screenshots
export type AvenueTab = "all" | "club_service" | "community_service" | "vocational_service"
               | "international_service" | "new_generation_service"
               | "public_image_initiative";

export const AVENUE_TABS: { key: AvenueTab; label: string }[] = [
  { key: "all",                     label: "All" },
  { key: "club_service",            label: "Club Service" },
  { key: "community_service",       label: "Community Service" },
  { key: "vocational_service",      label: "Vocational Service" },
  { key: "international_service",   label: "International Service" },
  { key: "new_generation_service",  label: "New Generation" },
  { key: "public_image_initiative", label: "Public Image" },
];

// Slug map used to build links into existing module pages
export const SLUG_MAP: Record<string, string> = {
  club_service:            "club-service/v2",
  community_service:       "community-service/v2",
  vocational_service:      "vocational-service/v2",
  international_service:   "international-service/v2",
  new_generation_service:  "new-generation-service/v2",
  public_image_initiative: "public-image-initiative/v2",
};

export function avenueBadgeStyle(key: string): string {
  switch (key) {
    case "club_service":            return "bg-blue-50 text-blue-700 border-blue-200";
    case "community_service":       return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "vocational_service":      return "bg-amber-50 text-amber-700 border-amber-200";
    case "international_service":   return "bg-slate-50 text-slate-700 border-slate-200";
    case "new_generation_service":  return "bg-pink-50 text-pink-700 border-pink-200";
    case "public_image_initiative": return "bg-orange-50 text-orange-700 border-orange-200";
    default:                        return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

export function projectTypeChipStyle(t: string) {
  const lo = t.toLowerCase();
  if (lo.includes("one"))     return "bg-blue-50 text-blue-700 border-blue-200";
  if (lo.includes("recur"))   return "bg-slate-50 text-slate-700 border-slate-200";
  if (lo.includes("annual"))  return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

// Dollar currencies get the dollar glyph, every other currency a neutral coin.
export function moneyIcon(code?: string | null) {
  const which = moneyIconName(code);
  return which === "dollar" ? DollarSign : Coins;
}

export function attendancePercentChip(pct: number) {
  if (pct >= 75) return "bg-emerald-100 text-emerald-700";
  if (pct >= 50) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

// Compact money in the instance currency by default; currency-aware totals/rows pass the district or project currency.
export const shortInr = (value: number): string => shortMoney(value, defaultCurrency());

// Whitelist guard — keeps URL params safe when reading ?tab=
export function isAvenueTab(v: string | null): v is AvenueTab {
  return !!v && AVENUE_TABS.some((t) => t.key === v);
}
