import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "../../config/app-config";
import { payLinkKey } from "../website-pay-link.token";

/**
 * Port of ProjectSyncToken.cs: AES-256-GCM token handed to the Rotary.org publishing helper, carrying
 * { project, club, expiry, member }. base64url(nonce(12) || ciphertext || tag(16)); same key as the pay links.
 */
const NONCE = 12, TAG = 16;

export function generateProjectSyncToken(config: AppConfig, projectId: number, clubId: number, memberId: number | null = null, lifetimeDays = 30): string {
  const expiry = Math.floor(Date.now() / 1000) + lifetimeDays * 86400;
  const json = memberId && memberId > 0 ? `{"p":${projectId},"c":${clubId},"e":${expiry},"m":${memberId}}` : `{"p":${projectId},"c":${clubId},"e":${expiry}}`;
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", payLinkKey(config), nonce, { authTagLength: TAG });
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString("base64url");
}

export function decryptProjectSyncToken(config: AppConfig, token: string | null | undefined):
  { payload: { projectId: number; clubId: number; expiryUnix: number; memberId: number | null } | null; error: string | null } {
  if (!token || !token.trim()) return { payload: null, error: "Missing sync token." };
  let combined: Buffer;
  try {
    combined = Buffer.from(token, "base64url");
  } catch {
    return { payload: null, error: "Invalid or malformed token." };
  }
  if (combined.length < NONCE + TAG + 1) return { payload: null, error: "Invalid or malformed token." };
  let plain: string;
  try {
    const d = createDecipheriv("aes-256-gcm", payLinkKey(config), combined.subarray(0, NONCE), { authTagLength: TAG });
    d.setAuthTag(combined.subarray(combined.length - TAG));
    plain = Buffer.concat([d.update(combined.subarray(NONCE, combined.length - TAG)), d.final()]).toString("utf8");
  } catch {
    return { payload: null, error: "This token is invalid or has been tampered with." };
  }
  let payload;
  try {
    const j = JSON.parse(plain);
    if (!Number.isInteger(j.p) || !Number.isInteger(j.c) || !Number.isInteger(j.e)) throw new Error("shape");
    payload = { projectId: j.p as number, clubId: j.c as number, expiryUnix: j.e as number, memberId: Number.isInteger(j.m) ? (j.m as number) : null };
  } catch {
    return { payload: null, error: "This token is invalid." };
  }
  if (payload.expiryUnix < Date.now() / 1000) return { payload: null, error: "This sync token has expired." };
  return { payload, error: null };
}

/**
 * ASP.NET DataProtection's format cannot be read outside .NET, so ROW keeps club Rotary.org credentials with
 * AES-256-GCM: "v1:" + base64(nonce || tag || ciphertext). Key: SHA-256 of Credentials:EncryptionKey, else of the
 * JWT secret. A value that does not decrypt reads as absent (as Unprotect failures did).
 */
function credentialKey(config: AppConfig) {
  const raw = config.get("Credentials:EncryptionKey") || config.get("JwtSettings:Secret");
  if (!raw) throw new Error("Credentials:EncryptionKey or JwtSettings:Secret must be configured.");
  return createHash("sha256").update(`club-rotary-org-credentials.v1|${raw}`, "utf8").digest();
}

export function protectCredential(config: AppConfig, plain: string): string {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv("aes-256-gcm", credentialKey(config), nonce, { authTagLength: TAG });
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([nonce, c.getAuthTag(), ct]).toString("base64");
}

export function unprotectCredential(config: AppConfig, cipher: string | null | undefined): string | null {
  if (!cipher || !cipher.startsWith("v1:")) return null;
  try {
    const b = Buffer.from(cipher.slice(3), "base64");
    const d = createDecipheriv("aes-256-gcm", credentialKey(config), b.subarray(0, NONCE), { authTagLength: TAG });
    d.setAuthTag(b.subarray(NONCE, NONCE + TAG));
    return Buffer.concat([d.update(b.subarray(NONCE + TAG)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
