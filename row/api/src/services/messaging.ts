import { Injectable, Logger } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { Brand } from "../brand/brand";
import type { DbCommands } from "../database/db.service";

/**
 * ROW's messaging providers (master plan WS6M), replacing RIZones' Indian ones
 * (DLT SMS, Interakt WhatsApp):
 *   SMS       -> Twilio           (Brand__Providers__Twilio__AccountSid / __AuthToken / __MessagingServiceSid)
 *   WhatsApp  -> Meta Cloud API   (Brand__Providers__MetaWhatsApp__AccessToken / __PhoneNumberId / __ApiVersion)
 * Credentials come from the environment. A provider without credentials
 * reports "not sent" instead of throwing, so callers can fall back.
 */

/** "+1" + "416 555 0100" -> "+14165550100". A national number's trunk "0" is dropped. Null when unusable. */
export function toE164(nationalNumber: string | null | undefined, dialCode: string | null | undefined): string | null {
  const raw = (nationalNumber ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("+")) {
    const digits = raw.replace(/[^\d]/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const code = (dialCode ?? "").replace(/[^\d]/g, "");
  if (!code) return null;
  let digits = raw.replace(/[^\d]/g, "").replace(/^0+/, "");
  if (digits.startsWith(code) && digits.length > code.length + 6) digits = digits.slice(code.length);
  const full = code + digits;
  return full.length >= 8 && full.length <= 15 ? `+${full}` : null;
}

/** The dial code ("+44") and ISO code ("GB") of a country_master row. */
export async function countryDialInfo(conn: DbCommands, countryId: number | null | undefined): Promise<{ dialCode: string | null; iso: string | null }> {
  if (!countryId) return { dialCode: null, iso: null };
  const row = await conn.queryFirstOrDefault("SELECT PhoneCode, CountryCode FROM country_master WHERE pk_country_id = @Id", { Id: countryId });
  return { dialCode: row?.PhoneCode ?? null, iso: row?.CountryCode ?? null };
}

/** The OTP channels for a country, in order, from the brand's policy (country first, then "*"). */
export function otpChannelsFor(countryIso: string | null): string[] {
  const policy = Brand.Current.providers.otpPolicy;
  return (countryIso && policy[countryIso.toUpperCase()]) || policy["*"] || ["email"];
}

@Injectable()
export class SmsSender {
  private readonly log = new Logger("SmsSender");
  constructor(private readonly config: AppConfig) {}

  /** Send a text; true when the provider accepted it. */
  async send(toE164: string, text: string): Promise<boolean> {
    if (Brand.Current.providers.sms !== "twilio") return false;
    const sid = this.config.get("Brand:Providers:Twilio:AccountSid");
    const token = this.config.get("Brand:Providers:Twilio:AuthToken");
    const service = this.config.get("Brand:Providers:Twilio:MessagingServiceSid");
    if (!sid || !token || !service) {
      this.log.warn("Twilio is not configured; SMS not sent.");
      return false;
    }
    try {
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: toE164, MessagingServiceSid: service, Body: text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) this.log.error(`Twilio ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      return resp.ok;
    } catch (e) {
      this.log.error(`Twilio send failed: ${(e as Error).message}`);
      return false;
    }
  }
}

@Injectable()
export class WhatsAppSender {
  private readonly log = new Logger("WhatsAppSender");
  constructor(private readonly config: AppConfig) {}

  /**
   * Send an approved template. `bodyParams` fill {{1}}, {{2}} ... in order.
   * Authentication templates (OTP) also take the code as a copy-code button parameter.
   */
  async sendTemplate(toE164: string, templateName: string, language: string, bodyParams: string[], otpButton?: string): Promise<boolean> {
    if (Brand.Current.providers.whatsApp !== "meta") return false;
    const token = this.config.get("Brand:Providers:MetaWhatsApp:AccessToken");
    const phoneNumberId = this.config.get("Brand:Providers:MetaWhatsApp:PhoneNumberId");
    const version = this.config.get("Brand:Providers:MetaWhatsApp:ApiVersion") ?? "v21.0";
    if (!token || !phoneNumberId) {
      this.log.warn("Meta WhatsApp is not configured; message not sent.");
      return false;
    }
    const components: unknown[] = [];
    if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) });
    if (otpButton) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otpButton }] });
    try {
      const resp = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toE164.replace(/^\+/, ""),
          type: "template",
          template: { name: templateName, language: { code: language }, components },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) this.log.error(`Meta WhatsApp ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      return resp.ok;
    } catch (e) {
      this.log.error(`Meta WhatsApp send failed: ${(e as Error).message}`);
      return false;
    }
  }
}

/** A member's mobile in E.164, using the dial code of the member's primary country. Null when it cannot be formed. */
export async function memberE164(conn: DbCommands, memberId: number, mobile: string | null | undefined): Promise<string | null> {
  const countryId = await conn.executeScalar<number>("SELECT fk_primary_country_id FROM member_master_profile WHERE pk_member_master_profile_id = @Id", { Id: memberId });
  const { dialCode } = await countryDialInfo(conn, countryId ? Number(countryId) : null);
  return toE164(mobile, dialCode);
}
