import { Brand } from "../brand/brand";

/** Port of WebsiteDomainHelper.cs. */

function stripToHost(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "";
  let v = raw.trim().toLowerCase();
  v = v.replace(/^[a-z][a-z0-9+.\-]*:\/\//, "");
  v = v.replace(/^\/+/, "");
  const cut = v.search(/[/?#]/);
  if (cut >= 0) v = v.slice(0, cut);
  const colon = v.indexOf(":");
  if (colon >= 0) v = v.slice(0, colon);
  return v.trim().replace(/^\.+|\.+$/g, "");
}

export function normalizeSubdomain(raw: string | null | undefined): string {
  const host = stripToHost(raw);
  if (!host) return "";
  const dot = host.indexOf(".");
  return dot >= 0 ? host.slice(0, dot) : host;
}

/**
 * The label without any known parent domain. The parent list comes from the
 * brand (master plan WS1-06, Domains.ClubSiteSuffixes), whose default is the
 * list the C# hard-coded.
 */
export function bareSubdomain(raw: string | null | undefined): string {
  const host = stripToHost(raw);
  if (!host) return "";
  for (const s of Brand.Current.domains.clubSiteSuffixes) {
    const suffix = "." + s.toLowerCase();
    if (host.endsWith(suffix)) return host.slice(0, -suffix.length);
  }
  return host;
}

export function normalizeClientDomain(raw: string | null | undefined): string | null {
  const host = stripToHost(raw);
  return host ? host : null;
}

export function validateSubdomain(value: string | null | undefined, fieldName = "Subdomain"): string | null {
  if (!value || !value.trim()) return `${fieldName} is required.`;
  if (value.length > 253) return `${fieldName} is too long (max 253 characters).`;
  return null;
}

export function validateClientDomain(value: string | null | undefined, fieldName = "Client Domain"): string | null {
  if (!value || !value.trim()) return null;
  if (value.length > 253) return `${fieldName} is too long (max 253 characters).`;
  return null;
}

export function validatePurchaseSubdomainInput(input: string | null | undefined): string | null {
  const v = (input ?? "").trim().toLowerCase();
  if (v.length < 3 || v.length > 30) return "Subdomain must be 3–30 characters.";
  if (!/^[a-z0-9]+$/.test(v)) return "Only lowercase letters a–z and digits 0–9 are allowed.";
  return null;
}

export function buildPurchaseLabel(input: string | null | undefined): string {
  return "rc" + (input ?? "").trim().toLowerCase();
}
