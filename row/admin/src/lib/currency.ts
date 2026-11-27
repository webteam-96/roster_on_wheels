// DISPLAY ONLY: the currency code stored on a project and every amount are untouched;
// these helpers decide how amounts are printed. The currencies offered and the
// default come from the instance brand (brand.locale.currencies / defaultCurrency),
// and symbols, grouping and decimals come from Intl for the current locale.

import { getActiveBrand } from "@/lib/brand";
import { appFormat, currencySymbol, defaultCurrency } from "@/lib/appFormat";

export interface CurrencyOption {
  code: string;
  label: string;
  symbol: string;
}

/** The currencies this instance offers, labelled "US Dollar (USD)" in the interface language. */
export function currencyOptions(): CurrencyOption[] {
  const fmt = appFormat();
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([fmt.locale], { type: "currency" });
  } catch {
    names = null;
  }
  const base = defaultCurrency();
  return getActiveBrand().locale.currencies
    .map((code) => {
      const name = names?.of(code) ?? code;
      return { code, label: name === code ? code : `${name} (${code})`, symbol: fmt.currencySymbol(code) };
    })
    // The instance's own currency first, then by name: the list covers every district's country.
    .sort((a, b) => Number(b.code === base) - Number(a.code === base) || a.label.localeCompare(b.label));
}

/** A total over amounts in several currencies, one figure per currency ("€1.2K + $3K"): different currencies are
 *  never added together without a rate. */
export function moneyTotals(
  rows: readonly { amount?: number | null; currency?: string | null }[],
  format: (value: number, code: string) => string = shortMoney,
): string {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const code = (r.currency || defaultCurrency()).toUpperCase();
    if (r.amount) totals.set(code, (totals.get(code) ?? 0) + Number(r.amount));
  }
  if (totals.size === 0) return format(0, defaultCurrency());
  return [...totals].sort((a, b) => b[1] - a[1]).map(([code, sum]) => format(sum, code)).join(" + ");
}

// Which lucide icon belongs beside an amount: a dollar sign for dollar
// currencies, a neutral coin for everything else.
export function moneyIconName(code?: string | null): "dollar" | "coins" {
  return currencySymbol(code).includes("$") ? "dollar" : "coins";
}

export function getCurrencySymbol(code?: string | null): string {
  return currencySymbol(code);
}

// Compact money with the currency's symbol ("$1.2M", "€3.4K").
export function shortMoney(value?: number | null, code?: string | null): string {
  return appFormat().moneyShort(Number(value) || 0, code || defaultCurrency());
}

// Full money with grouping ("$105", "€1,250.50", "￥12,000").
export function formatMoney(value?: number | null, code?: string | null): string {
  return appFormat().money(Number(value) || 0, code || defaultCurrency());
}

// A project's default currency: the district's configured default when it is one
// the instance offers, else the instance default.
export function resolveDefaultCurrency(_districtCountry?: string | null): string {
  return defaultCurrency();
}

// Club Dues / District Dues defaults for a NEW dues (RIZones 2026-11-09, ROW form): email on, and the
// district's default currency when the instance offers it, else the instance default. ROW has no WhatsApp.
// Super Admin can still change them on the form.
export function duesDefaultsForDistrict(districtDefaultCurrency?: string | null): { notifyEmail: boolean; currency: string } {
  const explicit = (districtDefaultCurrency ?? "").trim().toUpperCase();
  const currency = explicit && getActiveBrand().locale.currencies.includes(explicit) ? explicit : defaultCurrency();
  return { notifyEmail: true, currency };
}

// Pre-selects a project's currency from the district default (set by a
// SuperAdmin); falls back to the instance default. The user can always change it.
export function resolveClubDefaultCurrency(club: {
  districtDefaultCurrency?: string | null;
  districtCountry?: string | null;
}): string {
  const explicit = (club.districtDefaultCurrency ?? "").trim().toUpperCase();
  if (explicit && getActiveBrand().locale.currencies.includes(explicit)) return explicit;
  return resolveDefaultCurrency(club.districtCountry);
}
