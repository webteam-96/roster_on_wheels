import { Injectable, Logger } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { Brand } from "../brand/brand";

export interface ZoomMeetingResult { meetingId: string; joinUrl: string; startUrl: string }

/**
 * Port of ZoomMeetingService.cs: Zoom Server-to-Server OAuth, token cached until 5 minutes
 * before expiry. Start times are naive wall-clock ("yyyy-MM-ddTHH:mm:ss") in Zoom:Timezone
 * (default: the brand time zone; RIZones: Asia/Kolkata). Never throws: failures log and return null/false.
 */
@Injectable()
export class ZoomMeetingService {
  private readonly log = new Logger("ZoomMeetingService");
  private token: string | null = null;
  private tokenExpiry = 0;
  private pending: Promise<string | null> | null = null;

  constructor(private readonly config: AppConfig) {}

  private get baseUrl() { return (this.config.get("Zoom:BaseUrl") ?? "https://api.zoom.us/v2").replace(/\/+$/, ""); }
  private get oauthUrl() { return this.config.get("Zoom:OAuthUrl") ?? "https://zoom.us/oauth/token"; }
  private get hostUserId() { return this.config.get("Zoom:HostUserId") ?? "me"; }
  private get timezone() { return this.config.get("Zoom:Timezone") ?? Brand.Current.locale.defaultTimeZone; }
  private static present = (v: string | undefined) => !!v && !!v.trim() && !v.toUpperCase().includes("PLACEHOLDER");

  get isConfigured() {
    return ZoomMeetingService.present(this.config.get("Zoom:AccountId")) && ZoomMeetingService.present(this.config.get("Zoom:ClientId")) && ZoomMeetingService.present(this.config.get("Zoom:ClientSecret"));
  }

  private async getToken(): Promise<string | null> {
    if (!this.isConfigured) return null;
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    this.pending ??= this.fetchToken().finally(() => (this.pending = null));
    return this.pending;
  }

  private async fetchToken(): Promise<string | null> {
    try {
      const basic = Buffer.from(`${this.config.get("Zoom:ClientId")}:${this.config.get("Zoom:ClientSecret")}`).toString("base64");
      const res = await fetch(`${this.oauthUrl}?grant_type=account_credentials&account_id=${encodeURIComponent(this.config.get("Zoom:AccountId")!)}`, {
        method: "POST", headers: { Authorization: `Basic ${basic}` },
      });
      const body = await res.text();
      if (!res.ok) {
        this.log.error(`Zoom token request failed: ${res.status} ${body}`);
        return null;
      }
      const doc = JSON.parse(body) as { access_token: string; expires_in?: number };
      this.token = doc.access_token;
      this.tokenExpiry = Date.now() + Math.max(60, (doc.expires_in ?? 3600) - 300) * 1000; // refresh 5 min early
      return this.token;
    } catch (e) {
      this.log.error(`Zoom token request threw: ${(e as Error).message}`);
      return null;
    }
  }

  /** startLocal = "yyyy-MM-ddTHH:mm:ss" wall clock in the Zoom time zone. */
  async createMeeting(topic: string, startLocal: string, durationMinutes: number): Promise<ZoomMeetingResult | null> {
    const token = await this.getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${this.baseUrl}/users/${this.hostUserId}/meetings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          topic, type: 2, start_time: startLocal, timezone: this.timezone, duration: durationMinutes,
          settings: { join_before_host: true, waiting_room: false, host_video: true, participant_video: true },
        }),
      });
      const body = await res.text();
      if (!res.ok) {
        this.log.error(`Zoom create-meeting failed: ${res.status} ${body}`);
        return null;
      }
      const root = JSON.parse(body) as { id?: number | string; join_url?: string; start_url?: string };
      const id = root.id === undefined || root.id === null ? null : String(root.id);
      if (!id || !root.join_url) return null;
      return { meetingId: id, joinUrl: root.join_url, startUrl: root.start_url ?? "" };
    } catch (e) {
      this.log.error(`Zoom create-meeting threw: ${(e as Error).message}`);
      return null;
    }
  }

  async updateMeetingTime(meetingId: string, startLocal: string, durationMinutes: number): Promise<boolean> {
    const token = await this.getToken();
    if (!token || !meetingId.trim()) return false;
    try {
      const res = await fetch(`${this.baseUrl}/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ start_time: startLocal, timezone: this.timezone, duration: durationMinutes }),
      });
      if (!res.ok) {
        this.log.error(`Zoom update-meeting failed: ${res.status} ${await res.text()}`);
        return false;
      }
      return true;
    } catch (e) {
      this.log.error(`Zoom update-meeting threw: ${(e as Error).message}`);
      return false;
    }
  }
}
