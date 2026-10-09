import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "../config/app-config";

/**
 * Port of WebsitePayLinkToken.cs: AES-256-GCM token in club-website pay links
 * (/pay/club-website/{token}) carrying only { clubId, yearId, expiry }; the
 * price is always resolved server-side. Token = base64url(nonce(12) || ciphertext || tag(16)).
 * Key: SHA-256 of Payments:PayLinkKey (RIZones: Razorpay:PayLinkKey), else of JwtSettings:Secret.
 */
const NONCE = 12;
const TAG = 16;

function key(config: AppConfig): Buffer {
  const raw = config.get("Payments:PayLinkKey") || config.get("JwtSettings:Secret");
  if (!raw) throw new Error("Payments:PayLinkKey or JwtSettings:Secret must be configured.");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function generatePayLinkToken(config: AppConfig, clubId: number, yearId: number, lifetimeDays = 30): string {
  const expiry = Math.floor(Date.now() / 1000) + lifetimeDays * 86400;
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", key(config), nonce, { authTagLength: TAG });
  const ct = Buffer.concat([cipher.update(`{"c":${clubId},"y":${yearId},"e":${expiry}}`, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString("base64url");
}

export function decryptPayLinkToken(config: AppConfig, token: string | null | undefined): { payload: { clubId: number; yearId: number; expiryUnix: number } | null; error: string | null } {
  if (!token || !token.trim()) return { payload: null, error: "Missing link token." };
  const combined = Buffer.from(token, "base64url");
  if (combined.length < NONCE + TAG + 1) return { payload: null, error: "Invalid or malformed link." };
  let plain: string;
  try {
    const d = createDecipheriv("aes-256-gcm", key(config), combined.subarray(0, NONCE), { authTagLength: TAG });
    d.setAuthTag(combined.subarray(combined.length - TAG));
    plain = Buffer.concat([d.update(combined.subarray(NONCE, combined.length - TAG)), d.final()]).toString("utf8");
  } catch {
    return { payload: null, error: "This link is invalid or has been tampered with." };
  }
  let payload;
  try {
    const j = JSON.parse(plain);
    payload = { clubId: Number(j.c), yearId: Number(j.y), expiryUnix: Number(j.e) };
    if (![payload.clubId, payload.yearId, payload.expiryUnix].every(Number.isInteger)) throw new Error();
  } catch {
    return { payload: null, error: "This link is invalid." };
  }
  if (payload.expiryUnix * 1000 < Date.now()) return { payload: null, error: "This payment link has expired. Please ask the Rotary office for a fresh link." };
  return { payload, error: null };
}
