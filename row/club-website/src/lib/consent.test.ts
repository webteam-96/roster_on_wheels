// Run: node --test src/lib/consent.test.ts  (Node 22.6+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSENT_COOKIE, readConsent, consentCookie } from "./consent.ts";

test("no cookie means no choice yet (banner shows, embeds stay off)", () => {
  assert.equal(readConsent(""), null);
  assert.equal(readConsent("other=1; theme=x"), null);
});

test("reads the stored choice and ignores junk values", () => {
  assert.equal(readConsent(`a=1; ${CONSENT_COOKIE}=all`), "all");
  assert.equal(readConsent(`${CONSENT_COOKIE}=essential`), "essential");
  assert.equal(readConsent(`${CONSENT_COOKIE}=yes-please`), null);
});

test("the cookie lasts 180 days, site-wide, SameSite=Lax, Secure on https", () => {
  const c = consentCookie("essential", true);
  assert.match(c, new RegExp(`^${CONSENT_COOKIE}=essential;`));
  assert.match(c, /Max-Age=15552000/);
  assert.match(c, /Path=\//);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Secure/);
  assert.doesNotMatch(consentCookie("all", false), /Secure/);
});
