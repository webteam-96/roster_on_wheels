import { NextResponse } from "next/server";
import { decodeEntities } from "@/i18n/decodeEntities";

/**
 * Machine-translation endpoint for UI strings in any world language.
 *
 * POST { target: "<bcp47>", source?: "en", q: string[] } -> { translations: string[] }
 *
 * The provider is pluggable via env (keeps any API key server-side):
 *   TRANSLATE_PROVIDER = mymemory (default, no key) | libretranslate | google | deepl
 *   TRANSLATE_API_URL  = provider base URL (libretranslate)
 *   TRANSLATE_API_KEY  = provider key (libretranslate optional, google/deepl required)
 *   TRANSLATE_CONTACT_EMAIL = raises MyMemory's anonymous daily limit
 *
 * It never throws to the caller: any string that cannot be translated comes back
 * as its original English, so the UI degrades to English instead of breaking.
 *
 * Callers (2026-10-24): signed-in admin pages send their API token (i18n/postTranslate.ts), checked against the
 * API (GET api/auth/session). Sign-in and public pages of the admin have no token: they get visitor limits, and
 * text not yet cached is translated only while a daily character budget shared by all visitors lasts, so the
 * route cannot be used as a free translation service. Both are rate limited per IP (429).
 */

export const runtime = "nodejs";

const PROVIDER = (process.env.TRANSLATE_PROVIDER || "mymemory").toLowerCase();
const API_URL = process.env.TRANSLATE_API_URL || "";
const API_KEY = process.env.TRANSLATE_API_KEY || "";
const CONTACT = process.env.TRANSLATE_CONTACT_EMAIL || "";

// Per-process cache: target \u0000 text -> translation. One translation per unique string, ever.
const cache = new Map<string, string>();
const MAX_CACHE = 50_000;
const TIMEOUT_MS = 8000; // a stuck provider must not hold the request open

const API_BASE = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const SESSION_TTL_MS = 5 * 60_000; // a checked token is trusted this long before the API is asked again
const sessions = new Map<string, number>(); // token -> trusted until (ms)

// shortcut: limits live in this process, one admin server; move them to a shared store if the admin is scaled out.
const WINDOW_MS = 60_000;
const SIGNED_IN_LIMIT = 120; // requests per IP per minute
const VISITOR_LIMIT = 30;
const VISITOR_MAX_STRINGS = 300; // LiveTranslate sends at most 300 per request
const VISITOR_DAILY_CHARS = 200_000; // new (uncached) text for all visitors together; past it, new text stays English
const hits = new Map<string, { count: number; reset: number }>();
let visitorBudget = { day: "", used: 0 };

function tooMany() {
  return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "60" } });
}

// The nearest proxy (IIS, a load balancer) appends the address it saw; Next.js sets it from the socket when absent.
// shortcut: trusts one proxy hop; read an earlier entry if a CDN is put in front.
function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",").pop()?.trim() || "unknown";
}

function overLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (entry && entry.reset > now) return ++entry.count > limit;
  if (hits.size > 10_000) hits.forEach((v, k) => { if (v.reset <= now) hits.delete(k); });
  hits.set(key, { count: 1, reset: now + WINDOW_MS });
  return false;
}

/** True when the API accepts the token. API unreachable: treated as a visitor. */
async function sessionValid(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  if (sessions.size > 10_000) sessions.clear();
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return true;
}

/** Visitors: cached text is free; new text is paid from the daily budget. */
function visitorMayTranslate(text: string, target: string): boolean {
  if (cache.has(`${target}\u0000${text}`)) return true;
  const day = new Date().toISOString().slice(0, 10);
  if (visitorBudget.day !== day) visitorBudget = { day, used: 0 };
  if (visitorBudget.used + text.length > VISITOR_DAILY_CHARS) return false;
  visitorBudget.used += text.length;
  return true;
}

function providerLang(code: string): string {
  // Providers want a base language tag; keep script only where it matters.
  if (code === "zh-Hant") return PROVIDER === "mymemory" ? "zh-TW" : "zh-Hant";
  return code.split("-")[0];
}

async function translateOne(text: string, target: string, source: string): Promise<string> {
  if (!text.trim()) return text;
  const key = `${target}\u0000${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let out = text;
  try {
    if (PROVIDER === "libretranslate") {
      const res = await fetch(`${API_URL.replace(/\/$/, "")}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source, target: providerLang(target), format: "text", ...(API_KEY ? { api_key: API_KEY } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) out = (await res.json())?.translatedText || text;
    } else if (PROVIDER === "google") {
      const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source, target: providerLang(target), format: "text" }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) out = (await res.json())?.data?.translations?.[0]?.translatedText || text;
    } else if (PROVIDER === "deepl") {
      const res = await fetch("https://api-free.deepl.com/v2/translate", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `DeepL-Auth-Key ${API_KEY}` },
        body: new URLSearchParams({ text, source_lang: source.toUpperCase(), target_lang: providerLang(target).toUpperCase() }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) out = (await res.json())?.translations?.[0]?.text || text;
    } else {
      // MyMemory: free, no key. One phrase per request.
      const params = new URLSearchParams({ q: text, langpair: `${source}|${providerLang(target)}` });
      if (CONTACT) params.set("de", CONTACT);
      const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const data = await res.json();
        const t = data?.responseData?.translatedText;
        // MyMemory echoes a warning string in translatedText on quota errors; guard against it.
        if (typeof t === "string" && t && !/MYMEMORY WARNING|QUOTA/i.test(t)) out = t;
      }
    }
  } catch {
    out = text; // network/provider error -> English
  }

  out = decodeEntities(out) || text;
  if (cache.size < MAX_CACHE) cache.set(key, out);
  return out;
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const known = !!token && (sessions.get(token) ?? 0) > Date.now();
  // Unchecked tokens count as visitors first, so made-up tokens cannot make us call the API without limit.
  if (!known && overLimit(`v:${ip}`, VISITOR_LIMIT)) return tooMany();
  const signedIn = known || (!!token && (await sessionValid(token)));
  if (signedIn && overLimit(`s:${ip}`, SIGNED_IN_LIMIT)) return tooMany();

  let body: { target?: string; source?: string; q?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const target = (body.target || "").trim();
  const source = (body.source || "en").trim();
  const q = Array.isArray(body.q) ? body.q.filter((x): x is string => typeof x === "string") : [];
  if (!target || q.length === 0) return NextResponse.json({ translations: q });
  // Same language or unknown -> echo back.
  if (providerLang(target) === source) return NextResponse.json({ translations: q });

  const translations = await pool(q.slice(0, signedIn ? 2000 : VISITOR_MAX_STRINGS), 8, (text) =>
    signedIn || visitorMayTranslate(text, target) ? translateOne(text, target, source) : Promise.resolve(text));
  return NextResponse.json({ translations });
}
