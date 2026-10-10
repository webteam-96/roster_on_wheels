import { Injectable, Logger } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import jwt from "jsonwebtoken";
import { AppConfig } from "../../config/app-config";

export interface PushSendResult {
  token: string;
  success: boolean;
  firebaseMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Firebase says the token is invalid or unregistered, so it should be cleared. */
  isTokenInvalid: boolean;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** FCM v1 error codes ("SENDER_ID_MISMATCH") as the Admin SDK's MessagingErrorCode names ("SenderIdMismatch"). */
export function messagingErrorCode(code: string): string {
  return code.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

/**
 * Port of FirebasePushService.cs. The Admin SDK is replaced by the FCM HTTP v1 API
 * (the same per-token sends SendEachForMulticastAsync makes), authorised with the
 * service account's OAuth token. The service-account JSON comes from
 * Firebase:ServiceAccountAbsolutePath, else Firebase:ServiceAccountPath (relative to
 * the working directory, default App_Data/firebase-admin.json); without it push is
 * unavailable and sending is a no-op.
 */
@Injectable()
export class FirebasePushService {
  private readonly log = new Logger("FirebasePushService");
  private readonly account: ServiceAccount | null = null;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(config: AppConfig) {
    try {
      const absolute = config.get("Firebase:ServiceAccountAbsolutePath");
      const relative = config.get("Firebase:ServiceAccountPath") ?? "App_Data/firebase-admin.json";
      const path = absolute && absolute.trim() ? absolute : isAbsolute(relative) ? relative : join(process.cwd(), relative);
      if (!existsSync(path)) {
        this.log.warn(`Firebase service account file not found at ${path}. Push notifications DISABLED.`);
        return;
      }
      const account = JSON.parse(readFileSync(path, "utf8")) as ServiceAccount;
      if (!account.project_id || !account.client_email || !account.private_key) throw new Error("project_id, client_email and private_key are required.");
      this.account = account;
      this.log.log(`Firebase push initialized from ${path}`);
    } catch (e) {
      this.log.error(`Failed to initialize Firebase push. Push notifications DISABLED. ${(e as Error).message}`);
    }
  }

  get isAvailable() {
    return this.account !== null;
  }

  async sendMulticast(tokens: Iterable<string>, title: string, body: string, data: Record<string, string> | null): Promise<PushSendResult[]> {
    const results: PushSendResult[] = [];
    if (!this.account) {
      this.log.warn("Firebase not initialized — skipping push send");
      return results;
    }
    const all = [...new Set([...tokens].filter((t) => t && t.trim()))];
    const MULTICAST_LIMIT = 500;
    for (let i = 0; i < all.length; i += MULTICAST_LIMIT) {
      const batch = all.slice(i, i + MULTICAST_LIMIT);
      try {
        const accessToken = await this.getAccessToken();
        results.push(...(await Promise.all(batch.map((token) => this.sendOne(accessToken, token, title, body, data ?? {})))));
      } catch (e) {
        this.log.error(`Firebase multicast batch failed (batch starting at ${i}): ${(e as Error).message}`);
        for (const token of batch)
          results.push({ token, success: false, firebaseMessageId: null, errorCode: "BatchException", errorMessage: (e as Error).message, isTokenInvalid: false });
      }
    }
    return results;
  }

  private async sendOne(accessToken: string, token: string, title: string, body: string, data: Record<string, string>): Promise<PushSendResult> {
    const message = {
      token,
      notification: { title, body },
      data,
      android: { priority: "high", notification: { channel_id: "high_importance_channel_sound", sound: "notification" } },
      apns: { payload: { aps: { sound: "notification.caf", "content-available": 1 } } },
    };
    try {
      const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account!.project_id)}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(30_000),
      });
      const json = (await resp.json().catch(() => ({}))) as { name?: string; error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
      if (resp.ok) return { token, success: true, firebaseMessageId: json.name ?? null, errorCode: null, errorMessage: null, isTokenInvalid: false };
      const raw = json.error?.details?.find((d) => d.errorCode)?.errorCode ?? json.error?.status ?? null;
      const code = raw ? messagingErrorCode(raw) : null;
      return {
        token, success: false, firebaseMessageId: null, errorCode: code, errorMessage: json.error?.message ?? `HTTP ${resp.status}`,
        isTokenInvalid: code === "Unregistered" || code === "InvalidArgument" || code === "SenderIdMismatch",
      };
    } catch (e) {
      return { token, success: false, firebaseMessageId: null, errorCode: null, errorMessage: (e as Error).message, isTokenInvalid: false };
    }
  }

  /** An OAuth access token for the service account (JWT-bearer grant), cached until a minute before it expires. */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt) return this.accessToken.value;
    const a = this.account!;
    const tokenUri = a.token_uri ?? "https://oauth2.googleapis.com/token";
    const assertion = jwt.sign({ scope: "https://www.googleapis.com/auth/firebase.messaging" }, a.private_key, {
      algorithm: "RS256", issuer: a.client_email, audience: tokenUri, expiresIn: 3600,
    });
    const resp = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await resp.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!resp.ok || !json.access_token) throw new Error(`OAuth token request failed (${resp.status}): ${json.error_description ?? ""}`);
    this.accessToken = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
    return json.access_token;
  }
}
