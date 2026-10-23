import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The translate route's guard: signed-in callers are checked against the API; visitors (sign-in and public pages)
// get a lower per-IP limit, fewer strings per request and a daily budget for new text. Values mirror route.ts.
const API = "http://api.test";
const VISITOR_LIMIT = 30;
const SIGNED_IN_LIMIT = 120;
const VISITOR_MAX_STRINGS = 300;
const VISITOR_DAILY_CHARS = 200_000;

let route: typeof import("./route");
let fetchMock: ReturnType<typeof vi.fn>;

const apiCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(API)).length;
const providerCalls = () => fetchMock.mock.calls.filter(([u]) => !String(u).startsWith(API)).length;

function post(q: string[], { token, ip = "203.0.113.7" }: { token?: string; ip?: string } = {}) {
  return route.POST(
    new Request("http://admin.test/api/i18n/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ target: "fr", source: "en", q }),
    }),
  );
}

const translated = async (res: Response) => ((await res.json()) as { translations: string[] }).translations;

beforeEach(async () => {
  vi.stubEnv("API_INTERNAL_URL", API);
  vi.stubEnv("TRANSLATE_PROVIDER", "mymemory");
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith(API)) {
      const ok = u === `${API}/api/auth/session` && new Headers(init?.headers).get("Authorization") === "Bearer good";
      return new Response(null, { status: ok ? 204 : 401 });
    }
    return Response.json({ responseData: { translatedText: `fr:${new URL(u).searchParams.get("q")}` } });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules(); // fresh limits, sessions and cache per test
  route = await import("./route");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("translate route guard", () => {
  it("checks a signed-in token against the API once, then translates", async () => {
    expect(await translated(await post(["Hello"], { token: "good" }))).toEqual(["fr:Hello"]);
    expect(await translated(await post(["Members"], { token: "good" }))).toEqual(["fr:Members"]);
    expect(apiCalls()).toBe(1);
  });

  it("treats a token the API rejects as a visitor", async () => {
    const q = Array.from({ length: VISITOR_MAX_STRINGS + 1 }, (_, i) => `Text ${i}`);
    expect(await translated(await post(q, { token: "forged" }))).toHaveLength(VISITOR_MAX_STRINGS);
    expect(await translated(await post(q, { token: "good" }))).toHaveLength(VISITOR_MAX_STRINGS + 1);
  });

  it("limits visitors per IP, using the address the nearest proxy added", async () => {
    for (let i = 0; i < VISITOR_LIMIT; i++) expect((await post(["Hello"])).status).toBe(200);
    expect((await post(["Hello"])).status).toBe(429);
    expect((await post(["Hello"], { ip: "198.51.100.9, 203.0.113.7" })).status).toBe(429); // client-supplied first hop
    expect((await post(["Hello"], { ip: "203.0.113.8" })).status).toBe(200);
  });

  it("does not let made-up tokens call the API past the visitor limit", async () => {
    for (let i = 0; i < VISITOR_LIMIT; i++) await post(["Hello"], { token: `forged-${i}` });
    expect((await post(["Hello"], { token: "forged-x" })).status).toBe(429);
    expect(apiCalls()).toBe(VISITOR_LIMIT);
  });

  it("limits signed-in callers per IP", async () => {
    for (let i = 0; i < SIGNED_IN_LIMIT; i++) expect((await post(["Hello"], { token: "good" })).status).toBe(200);
    expect((await post(["Hello"], { token: "good" })).status).toBe(429);
  });

  it("stops visitors' new text at the daily budget but still serves cached text", async () => {
    const big = "a".repeat(VISITOR_DAILY_CHARS - 10);
    expect(await translated(await post([big]))).toEqual([`fr:${big}`]);
    const calls = providerCalls();
    expect(await translated(await post(["Eleven char"]))).toEqual(["Eleven char"]); // 11 > 10 left: stays English
    expect(await translated(await post([big]))).toEqual([`fr:${big}`]); // cached
    expect(providerCalls()).toBe(calls);
    expect(await translated(await post(["Eleven char"], { token: "good" }))).toEqual(["fr:Eleven char"]);
  });
});
