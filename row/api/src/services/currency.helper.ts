import { Brand } from "../brand/brand";

/**
 * Port of CurrencyHelper.cs for ROW: the accepted currencies are the brand's
 * list (ISO 4217); anything else falls back to the brand's default currency.
 */
function allowed(): Set<string> {
  return new Set(Brand.Current.locale.currencies.map((c) => c.toUpperCase()));
}

export function normalizeCurrency(currency: string | null | undefined): string {
  const c = (currency ?? "").trim().toUpperCase();
  return c && allowed().has(c) ? c : Brand.Current.locale.defaultCurrency.toUpperCase();
}

/**
 * Convert between currencies with rates expressed against one base currency:
 * rates[X] = units of the base per 1 unit of X (the base itself is 1).
 */
export function convertCurrency(amount: number, from: string | null | undefined, to: string | null | undefined, rates: Readonly<Record<string, number>>): number {
  const f = normalizeCurrency(from);
  const t = normalizeCurrency(to);
  if (amount === 0 || f === t) return amount;
  const rf = rates[f] ?? 1;
  const rt = rates[t] ?? 1;
  return rt <= 0 ? amount : (amount * rf) / rt;
}

/** A district's currency: its explicit DefaultCurrency when valid, else the brand's default. */
export function resolveDefaultCurrency(districtDefaultCurrency: string | null | undefined): string {
  const explicit = (districtDefaultCurrency ?? "").trim().toUpperCase();
  return explicit && allowed().has(explicit) ? explicit : Brand.Current.locale.defaultCurrency.toUpperCase();
}
