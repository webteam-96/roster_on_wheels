import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Port of AdminProxyAuth.cs (password part): the directory data-collection contact persons' passwords.
 * PBKDF2-HMAC-SHA256, 100k iterations, 16-byte salt, stored "{salt-base64}:{hash-base64}" — the same format,
 * so hashes written by RIZones verify here.
 */
const ITERATIONS = 100_000;

export function hashProxyPassword(password: string): string {
  if (!password) throw new Error("Password cannot be empty.");
  const salt = randomBytes(16);
  return `${salt.toString("base64")}:${pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256").toString("base64")}`;
}

export function verifyProxyPassword(password: string, stored: string | null | undefined): boolean {
  if (!password || !stored) return false;
  const i = stored.indexOf(":");
  if (i < 0) return false;
  try {
    const salt = Buffer.from(stored.slice(0, i), "base64");
    const expected = Buffer.from(stored.slice(i + 1), "base64");
    const actual = pbkdf2Sync(password, salt, ITERATIONS, expected.length, "sha256");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export interface AdminProxyTokenPayload { urlHash: string; mobile: string; slot: string; expUnix: number }

/**
 * Port of AdminProxyTokenSigner: "{base64 JSON}.{base64 HMAC-SHA256}" tokens for the directory form's admin
 * contacts. Key: AdminProxyToken:SigningKey, else the JWT secret (RIZones also had a constant dev fallback; ROW has none).
 */
export class AdminProxyTokenSigner {
  constructor(private readonly key: string) {
    if (!key) throw new Error("AdminProxyToken:SigningKey (or JwtSettings:Secret) is not configured");
  }

  private sign = (data: string) => createHmac("sha256", Buffer.from(this.key, "utf8")).update(data, "utf8").digest("base64");

  issue(urlHash: string, mobile: string, slot: string, ttlSeconds: number): string {
    const payload = Buffer.from(JSON.stringify({ urlHash, mobile, slot, exp: Math.floor(Date.now() / 1000) + ttlSeconds }), "utf8").toString("base64");
    return `${payload}.${this.sign(payload)}`;
  }

  /** Null when missing, tampered or expired. */
  validate(token: string | null | undefined): AdminProxyTokenPayload | null {
    if (!token || !token.trim()) return null;
    const i = token.indexOf(".");
    if (i < 0) return null;
    const [payload, sig] = [token.slice(0, i), token.slice(i + 1)];
    const expected = Buffer.from(this.sign(payload), "utf8"), actual = Buffer.from(sig, "utf8");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const root = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
      const exp = Number(root.exp);
      if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
      return { urlHash: String(root.urlHash ?? ""), mobile: String(root.mobile ?? ""), slot: String(root.slot ?? ""), expUnix: exp };
    } catch {
      return null;
    }
  }
}
