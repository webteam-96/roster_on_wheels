import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { AppConfig } from "../config/app-config";

/** Claims as the .NET tokens carry them: every value a string ("memberId": "42", "roles": "Admin,Member"). */
export type Claims = Record<string, string>;

/**
 * Issues and checks tokens exactly like the RIZones API (JwtSettings section,
 * HS256, issuer and audience checked, no "iat"/"nbf", 5-minute clock skew), so
 * tokens are interchangeable with what the web and mobile clients already handle.
 */
@Injectable()
export class JwtService {
  constructor(private readonly config: AppConfig) {}

  private get secret(): string {
    const s = this.config.get("JwtSettings:Secret");
    if (!s) throw new Error("JwtSettings:Secret is not configured");
    return s;
  }

  /** new JwtSecurityToken(issuer, audience, claims, expires: expiresAtUtc, HmacSha256) */
  sign(claims: Claims, expiresAtUtc: Date): string {
    return jwt.sign(
      { ...claims, exp: Math.floor(expiresAtUtc.getTime() / 1000), iss: this.config.get("JwtSettings:Issuer"), aud: this.config.get("JwtSettings:Audience") },
      this.secret,
      { algorithm: "HS256", noTimestamp: true },
    );
  }

  /** The validated claims, or null (bad signature, issuer, audience, or expired beyond the skew). */
  verify(token: string): Claims | null {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: ["HS256"],
        issuer: this.config.get("JwtSettings:Issuer"),
        audience: this.config.get("JwtSettings:Audience"),
        clockTolerance: 300, // TokenValidationParameters.ClockSkew default: 5 minutes
      });
      if (typeof payload === "string") return null;
      const claims: Claims = {};
      for (const [k, v] of Object.entries(payload)) claims[k] = Array.isArray(v) ? v.join(",") : String(v);
      return claims;
    } catch {
      return null;
    }
  }

  /** Read a token's claims without validating it (JwtSecurityTokenHandler.ReadJwtToken). */
  read(token: string): Claims | null {
    const payload = jwt.decode(token);
    if (!payload || typeof payload === "string") return null;
    const claims: Claims = {};
    for (const [k, v] of Object.entries(payload)) claims[k] = String(v);
    return claims;
  }
}
