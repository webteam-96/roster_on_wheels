import { Injectable, Logger } from "@nestjs/common";
import { Brand } from "../brand/brand";

/**
 * Port of CurrencyRateService.cs. Live exchange rates for the brand's
 * currencies from the free, key-less open.er-api.com feed, cached in memory
 * (12 h; 30 min after a failure). Rates are "units of the brand's default
 * currency per 1 unit of X" (RIZones used INR as that base), as
 * convertCurrency() expects. When the feed is unreachable every rate falls
 * back to 1 so cost totals still render.
 */
@Injectable()
export class CurrencyRateService {
  private readonly log = new Logger("CurrencyRateService");
  private cache: { rates: Readonly<Record<string, number>>; expires: number } | null = null;
  private inflight: Promise<Readonly<Record<string, number>>> | null = null;

  async getRates(): Promise<Readonly<Record<string, number>>> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.rates;
    this.inflight ??= this.load().finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async load() {
    const base = Brand.Current.locale.defaultCurrency.toUpperCase();
    const supported = [...new Set([base, ...Brand.Current.locale.currencies.map((c) => c.toUpperCase())])];
    const live = await this.fetchLive(base, supported);
    const rates = live ?? Object.fromEntries(supported.map((c) => [c, 1]));
    this.cache = { rates, expires: Date.now() + (live ? 12 * 3600_000 : 30 * 60_000) };
    return rates;
  }

  private async fetchLive(base: string, supported: string[]): Promise<Record<string, number> | null> {
    try {
      const resp = await fetch(`https://open.er-api.com/v6/latest/${base}`, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return null;
      const json = (await resp.json()) as { result?: string; rates?: Record<string, number> };
      if (json.result && json.result !== "success") return null;
      if (!json.rates || typeof json.rates !== "object") return null;
      const map: Record<string, number> = { [base]: 1 };
      for (const code of supported) {
        if (code === base) continue;
        const perBase = json.rates[code];
        // The feed gives units of X per 1 base; we need base per 1 X.
        map[code] = typeof perBase === "number" && perBase > 0 ? 1 / perBase : 1;
      }
      return map;
    } catch (e) {
      this.log.warn(`Live FX fetch failed; using fallback/cached rates: ${(e as Error).message}`);
      return null;
    }
  }
}
