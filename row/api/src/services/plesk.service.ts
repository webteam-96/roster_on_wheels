import { Injectable, Logger } from "@nestjs/common";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { domainToASCII } from "node:url";
import { AppConfig } from "../config/app-config";
import { InvalidOperationException } from "../common/exceptions";

// ---- a minimal reader for Plesk's flat XML replies (XDocument.Descendants / Element) ----

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
/** SecurityElement.Escape */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Inner XML of every <tag>…</tag> (and "" for <tag/>), in document order. */
function descendants(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");
  for (let m; (m = re.exec(xml)); ) out.push(m[1] ?? "");
  return out;
}
const first = (xml: string, tag: string): string | null => {
  const d = descendants(xml, tag);
  return d.length ? decode(d[0].trim()) : null;
};
function propertyValue(xml: string, name: string): string | null {
  for (const p of descendants(xml, "property")) if (first(p, "name") === name) return first(p, "value");
  return null;
}

const xmlPacket = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<packet>
${body}
</packet>`;
const truncate = (s: string) => (s.length > 500 ? s.slice(0, 500) + "..." : s);
const notFound = (e: unknown) => e instanceof InvalidOperationException && /not found|does not exist|error 1013/i.test(e.message);

/**
 * Port of PleskService.cs: the Plesk XML API client (/enterprise/control/agent.php)
 * that provisions club / district website subdomains, aliases and certificates on
 * the Windows (IIS) hosting server. Settings: PleskSettings:* (BaseUrl, Username +
 * Password or ApiKey, ParentDomain, SharedDocroot, DistrictWebsiteSharedDocroot,
 * EnableAspNet, WildcardCertName, ServerIp, AcceptSelfSignedCert).
 */
@Injectable()
export class PleskService {
  private readonly log = new Logger("PleskService");
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly username: string;
  private readonly password: string;
  private readonly parentDomain: string;
  private readonly sharedDocroot: string;
  private readonly districtDocroot: string;
  private readonly protectedDocroots: string[];
  private readonly enableAspNet: boolean;
  private readonly wildcardCertName: string;
  private readonly serverIp: string;
  private readonly acceptSelfSigned: boolean;

  constructor(config: AppConfig) {
    const s = (k: string) => config.get(`PleskSettings:${k}`) ?? "";
    this.baseUrl = s("BaseUrl").replace(/\/+$/, "");
    this.apiKey = s("ApiKey").trim();
    this.username = s("Username").trim();
    this.password = s("Password");
    this.parentDomain = s("ParentDomain").trim();
    this.sharedDocroot = s("SharedDocroot").trim();
    this.districtDocroot = s("DistrictWebsiteSharedDocroot").trim();
    this.protectedDocroots = [this.sharedDocroot, this.districtDocroot].filter((x) => x);
    this.enableAspNet = s("EnableAspNet").toLowerCase() !== "false"; // default true
    this.wildcardCertName = s("WildcardCertName").trim();
    let ip = s("ServerIp").trim();
    if (!ip) {
      try {
        ip = new URL(this.baseUrl).hostname;
      } catch {
        // no BaseUrl
      }
    }
    this.serverIp = ip;
    this.acceptSelfSigned = s("AcceptSelfSignedCert").toLowerCase() === "true";
  }

  get clubSharedDocroot() {
    return this.sharedDocroot;
  }
  get districtSharedDocroot() {
    return this.districtDocroot;
  }
  /** The public IP customer domains must A-record to. */
  get ServerIp() {
    return this.serverIp;
  }
  get WildcardCertName() {
    return this.wildcardCertName;
  }
  get ParentDomain() {
    return this.parentDomain;
  }
  get isConfigured() {
    return !!this.baseUrl && (!!this.apiKey || (!!this.username && !!this.password));
  }

  /** POST a packet; resolves with [status, body]. */
  private post(packet: string): Promise<[number, string]> {
    if (!this.isConfigured) throw new InvalidOperationException("Plesk is not configured.");
    const url = new URL(`${this.baseUrl}/enterprise/control/agent.php`);
    const headers: Record<string, string> = { "Content-Type": "text/xml; charset=utf-8", HTTP_PRETTY_PRINT: "TRUE" };
    if (this.username) {
      headers.HTTP_AUTH_LOGIN = this.username;
      headers.HTTP_AUTH_PASSWD = this.password;
    } else if (this.apiKey) {
      headers.KEY = this.apiKey;
    }
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(url, { method: "POST", headers, timeout: 60_000, rejectUnauthorized: !this.acceptSelfSigned }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve([res.statusCode ?? 0, Buffer.concat(chunks).toString("utf8")]));
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("Plesk request timed out.")));
      req.on("error", reject);
      req.end(packet);
    });
  }

  /** SendPacketAsync: throws on HTTP, system-level and operation-level errors. */
  private async sendPacket(packet: string): Promise<string> {
    const [status, body] = await this.post(packet);
    if (status < 200 || status > 299) {
      this.log.error(`Plesk HTTP ${status}: ${body}`);
      throw new InvalidOperationException(`Plesk HTTP ${status}: ${truncate(body)}`);
    }
    if (!/^\s*(<\?xml[\s\S]*?\?>\s*)?</.test(body)) throw new InvalidOperationException(`Plesk returned non-XML: ${truncate(body)}`);
    for (const sys of descendants(body, "system")) {
      if (first(sys, "status") === "error") throw new InvalidOperationException(`Plesk system error ${first(sys, "errcode") ?? ""}: ${first(sys, "errtext") ?? "Unknown Plesk system error"}`);
    }
    for (const r of descendants(body, "result")) {
      if (first(r, "status") === "error") throw new InvalidOperationException(`Plesk error ${first(r, "errcode") ?? ""}: ${first(r, "errtext") ?? "Unknown Plesk error"}`);
    }
    return body;
  }

  /** SendRawAsync: the raw body, no error parsing. */
  private async sendRaw(packet: string): Promise<string> {
    return (await this.post(packet))[1];
  }

  async testConnection() {
    await this.sendPacket(xmlPacket("  <server>\n    <get>\n      <stat/>\n    </get>\n  </server>"));
  }

  private subdomainGet(fqdn: string) {
    return xmlPacket(`  <subdomain>\n    <get>\n      <filter>\n        <name>${esc(fqdn)}</name>\n      </filter>\n    </get>\n  </subdomain>`);
  }

  /**
   * Creates label.ParentDomain with Plesk's default docroot first (setting www_root on
   * create makes Plesk wipe the folder), then re-points it to the shared docroot.
   */
  async createSubdomain(label: string, docroot: string | null = this.sharedDocroot): Promise<number> {
    if (!label || !label.trim()) throw new Error("label required");
    if (!this.parentDomain) throw new InvalidOperationException("ParentDomain not configured");
    const props = this.enableAspNet ? "<property><name>asp_dot_net</name><value>true</value></property>" : "";
    const doc = await this.sendPacket(xmlPacket(`  <subdomain>\n    <add>\n      <parent>${esc(this.parentDomain)}</parent>\n      <name>${esc(label)}</name>\n      ${props}\n    </add>\n  </subdomain>`));
    const id = parseInt(first(doc, "id") ?? "0", 10) || 0;
    this.log.log(`Plesk subdomain created: ${label}.${this.parentDomain} (id=${id})`);
    if (docroot && docroot.trim()) await this.setSubdomainDocroot(label, docroot);
    return id;
  }

  /** Re-binds a subdomain's docroot without touching folder contents, then verifies it. */
  async setSubdomainDocroot(label: string, docroot: string) {
    const fqdn = `${label}.${this.parentDomain}`;
    await this.sendPacket(
      xmlPacket(`  <subdomain>\n    <set>\n      <filter><name>${esc(fqdn)}</name></filter>\n      <property><name>www_root</name><value>${esc(docroot)}</value></property>\n    </set>\n  </subdomain>`),
    );
    const actual = await this.getSubdomainDocroot(label);
    const trim = (s: string) => s.replace(/^[/\\]+|[/\\]+$/g, "").toLowerCase();
    if (actual && trim(actual) === trim(docroot)) {
      this.log.log(`Docroot set successfully for ${fqdn}: ${docroot}`);
      return;
    }
    throw new InvalidOperationException(
      `Plesk accepted www_root change but verification shows docroot still '${actual}' instead of '${docroot}'. ` +
        `Workaround: set it manually in Plesk panel → ${fqdn} → Hosting Settings → Document root = '${docroot}'.`,
    );
  }

  /** The certificate currently on a subdomain (Plesk Windows keeps it under <site>). */
  async getSubdomainCert(label: string): Promise<string | null> {
    const fqdn = esc(`${label}.${this.parentDomain}`);
    const certOf = (doc: string) => {
      for (const n of ["certificate_name", "certificate", "ssl_certificate"]) {
        const v = propertyValue(doc, n);
        if (v) return v;
      }
      return null;
    };
    try {
      const v = certOf(await this.sendPacket(xmlPacket(`  <site>\n    <get>\n      <filter><name>${fqdn}</name></filter>\n      <dataset>\n        <gen_info/>\n        <hosting/>\n      </dataset>\n    </get>\n  </site>`)));
      if (v) return v;
    } catch {
      // fall through to subdomain.get
    }
    try {
      return certOf(await this.sendPacket(xmlPacket(`  <subdomain>\n    <get>\n      <filter><name>${fqdn}</name></filter>\n      <dataset>\n        <gen_info/>\n        <hosting/>\n      </dataset>\n    </get>\n  </subdomain>`)));
    } catch {
      return null;
    }
  }

  /** Assigns an existing certificate, trying each packet shape Plesk versions accept, verified by read-back. */
  async assignCertificate(label: string, certificateName: string) {
    if (!label || !label.trim()) throw new Error("label required");
    if (!certificateName || !certificateName.trim()) throw new Error("certificateName required");
    const fqdn = `${label}.${this.parentDomain}`;
    const [f, c] = [esc(fqdn), esc(certificateName)];
    const vrt = (prop: string) => `<vrt_hst>\n            <property><name>ssl</name><value>true</value></property>\n            <property><name>${prop}</name><value>${c}</value></property>\n          </vrt_hst>`;
    const variants: [string, string][] = [
      ["A: site + values/hosting/vrt_hst + certificate_name", xmlPacket(`  <site>\n    <set>\n      <filter><name>${f}</name></filter>\n      <values>\n        <hosting>\n          ${vrt("certificate_name")}\n        </hosting>\n      </values>\n    </set>\n  </site>`)],
      ["B: site + values/hosting/vrt_hst + certificate-name (hyphen)", xmlPacket(`  <site>\n    <set>\n      <filter><name>${f}</name></filter>\n      <values>\n        <hosting>\n          ${vrt("certificate-name")}\n        </hosting>\n      </values>\n    </set>\n  </site>`)],
      ["C: site + hosting/vrt_hst + certificate_name", xmlPacket(`  <site>\n    <set>\n      <filter><name>${f}</name></filter>\n      <hosting>\n        ${vrt("certificate_name")}\n      </hosting>\n    </set>\n  </site>`)],
      ["D: webspace + values/hosting/vrt_hst + certificate_name", xmlPacket(`  <webspace>\n    <set>\n      <filter><name>${this.parentDomain}</name></filter>\n      <values>\n        <hosting>\n          ${vrt("certificate_name")}\n        </hosting>\n      </values>\n    </set>\n  </webspace>`)],
      ["E: certificate.install targeting site name", xmlPacket(`  <certificate>\n    <install>\n      <name>${c}</name>\n      <domain>${f}</domain>\n    </install>\n  </certificate>`)],
    ];
    const report: string[] = [];
    for (const [name, packet] of variants) {
      report.push(`--- ${name} ---`);
      try {
        const raw = await this.sendRaw(packet);
        report.push(truncate(raw));
        const actual = await this.getSubdomainCert(label);
        report.push(`  read-back cert = '${actual ?? "<none>"}'`);
        if (actual && actual.toLowerCase() === certificateName.toLowerCase()) {
          this.log.log(`Cert '${certificateName}' assigned to ${fqdn} via '${name}'`);
          await this.refreshSslBinding(label, certificateName);
          return;
        }
        this.log.warn(`Cert assignment '${name}' didn't stick. Raw Plesk response: ${truncate(raw)}`);
      } catch (e) {
        report.push(`  EXCEPTION: ${(e as Error).message}`);
        this.log.warn(`Cert assignment '${name}' failed: ${(e as Error).message}`);
      }
    }
    throw new InvalidOperationException(
      `Could not assign cert '${certificateName}' to '${fqdn}'. All variants tried — see details below.\n\n${report.join("\n")}\n\n` +
        `Workaround: Plesk panel → ${fqdn} → Hosting Settings → Certificate → select '${certificateName}'.`,
    );
  }

  /** Toggles SSL off then on so IIS rebuilds the binding (re-sending the cert, which some versions clear). */
  async refreshSslBinding(label: string, certificateName: string | null = null) {
    const f = esc(`${label}.${this.parentDomain}`);
    const set = (ssl: boolean, extra: string) =>
      xmlPacket(`  <site>\n    <set>\n      <filter><name>${f}</name></filter>\n      <values>\n        <hosting>\n          <vrt_hst>\n            <property><name>ssl</name><value>${ssl}</value></property>\n            ${extra}\n          </vrt_hst>\n        </hosting>\n      </values>\n    </set>\n  </site>`);
    try {
      await this.sendRaw(set(false, ""));
      await new Promise((r) => setTimeout(r, 500));
      await this.sendRaw(set(true, certificateName ? `<property><name>certificate_name</name><value>${esc(certificateName)}</value></property>` : ""));
      this.log.log(`SSL binding refreshed for ${label}.${this.parentDomain} (cert re-applied: ${!!certificateName})`);
    } catch (e) {
      this.log.warn(`SSL binding refresh failed for ${label}.${this.parentDomain}: ${(e as Error).message}`);
    }
  }

  /** Raw site / subdomain / webspace dumps for one FQDN. */
  async diagnosticSubdomain(label: string): Promise<string> {
    const f = esc(`${label}.${this.parentDomain}`);
    const out: string[] = [];
    for (const kind of ["site", "subdomain", "webspace"]) {
      out.push(`=== ${kind}.get ===`);
      try {
        out.push(await this.sendRaw(xmlPacket(`  <${kind}>\n    <get>\n      <filter><name>${f}</name></filter>\n      <dataset><gen_info/><hosting/></dataset>\n    </get>\n  </${kind}>`)));
      } catch (e) {
        out.push(`EXCEPTION: ${(e as Error).message}`);
      }
      out.push("");
    }
    return out.join("\n") + "\n";
  }

  async listAllSubdomains(): Promise<{ name: string; id: string }[]> {
    const doc = await this.sendPacket(xmlPacket("  <subdomain>\n    <get>\n      <filter/>\n    </get>\n  </subdomain>"));
    const list: { name: string; id: string }[] = [];
    for (const r of descendants(doc, "result")) {
      const name = first(r, "name") ?? "";
      if (name) list.push({ name, id: first(r, "id") ?? "" });
    }
    return list;
  }

  /** A third-party domain as a site alias of the club's subdomain (ascii-name must precede pref). */
  async addDomainAlias(primarySubdomain: string, aliasDomain: string) {
    const ascii = domainToASCII(aliasDomain.trim()) || aliasDomain.trim();
    await this.sendPacket(
      xmlPacket(
        `  <site-alias>\n    <create>\n      <site-id>${esc(await this.getSubdomainId(primarySubdomain))}</site-id>\n      <name>${esc(aliasDomain)}</name>\n      <ascii-name>${esc(ascii)}</ascii-name>\n      <pref>\n        <web>true</web>\n        <mail>false</mail>\n        <seo-redirect>false</seo-redirect>\n      </pref>\n    </create>\n  </site-alias>`,
      ),
    );
    this.log.log(`Plesk alias added: ${aliasDomain} -> ${primarySubdomain}`);
  }

  async domainAliasExists(domain: string): Promise<boolean> {
    if (!domain || !domain.trim()) return false;
    try {
      return !!first(await this.sendPacket(xmlPacket(`  <site-alias>\n    <get>\n      <filter>\n        <name>${esc(domain.trim())}</name>\n      </filter>\n    </get>\n  </site-alias>`)), "id");
    } catch (e) {
      if (notFound(e)) return false;
      throw e;
    }
  }

  private async letsEncrypt(domain: string): Promise<boolean> {
    try {
      await this.sendPacket(xmlPacket(`  <cli>\n    <exec>\n      <command>${esc("plesk bin extension --exec letsencrypt cli.php --domain " + domain)}</command>\n    </exec>\n  </cli>`));
      this.log.log(`Let's Encrypt provisioned for ${domain}`);
      return true;
    } catch (e) {
      this.log.warn(`Let's Encrypt provisioning failed for ${domain}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Best-effort Let's Encrypt for an exact third-party domain (the wildcard cert doesn't cover it). */
  tryProvisionLetsEncryptForDomain(domain: string): Promise<boolean> {
    return domain && domain.trim() ? this.letsEncrypt(domain.trim()) : Promise.resolve(false);
  }

  tryProvisionLetsEncrypt(label: string): Promise<boolean> {
    return this.letsEncrypt(`${label}.${this.parentDomain}`);
  }

  async subdomainExists(label: string): Promise<boolean> {
    try {
      return !!first(await this.sendPacket(this.subdomainGet(`${label}.${this.parentDomain}`)), "id");
    } catch (e) {
      if (notFound(e)) return false;
      throw e;
    }
  }

  private async getSubdomainId(fqdn: string): Promise<string> {
    const id = first(await this.sendPacket(this.subdomainGet(fqdn)), "id");
    if (!id) throw new InvalidOperationException(`Subdomain '${fqdn}' not found in Plesk`);
    return id;
  }

  async getSubdomainDocroot(label: string): Promise<string | null> {
    try {
      return propertyValue(await this.sendPacket(this.subdomainGet(`${label}.${this.parentDomain}`)), "www_root");
    } catch {
      return null;
    }
  }

  /** Deletes a subdomain, first re-pointing its docroot so Plesk cannot wipe the shared site folder. */
  async deleteSubdomain(label: string) {
    const fqdn = `${label}.${this.parentDomain}`;
    const current = await this.getSubdomainDocroot(label);
    this.log.log(`Current docroot for ${fqdn}: ${current ?? "<unknown>"}`);
    const throwaway = `subdomains/${label}`;
    try {
      await this.setSubdomainDocroot(label, throwaway);
      this.log.log(`Docroot re-pointed before delete: ${throwaway}`);
    } catch (e) {
      this.log.error(`Could not re-point docroot before delete. Current docroot: ${current}`);
      const trim = (s: string) => s.replace(/^[/\\]+|[/\\]+$/g, "").toLowerCase();
      const hit = current ? this.protectedDocroots.find((p) => trim(current) === trim(p)) : undefined;
      if (hit) {
        throw new InvalidOperationException(
          `Refusing to delete subdomain '${fqdn}' — docroot is still pointing to protected shared folder '${hit}' and re-point failed. ` +
            `Fix: in Plesk panel, manually change this subdomain's docroot to anything else, then retry delete. Plesk error: ${(e as Error).message}`,
        );
      }
      this.log.warn(`Proceeding with delete despite re-point failure — current docroot '${current}' does not match any protected folder`);
    }
    await this.sendPacket(xmlPacket(`  <subdomain>\n    <del>\n      <filter>\n        <name>${esc(fqdn)}</name>\n      </filter>\n    </del>\n  </subdomain>`));
    this.log.log(`Plesk subdomain deleted: ${fqdn}`);
  }

  /** Preset raw packets for the diagnostic endpoint. */
  async diagnosticRaw(type: string): Promise<{ request: string; response: string }> {
    const kind = { "list-subdomains": "subdomain", "list-sites": "site", "list-webspaces": "webspace" }[type];
    if (!kind) throw new Error("Unknown type. Use: list-subdomains, list-sites, list-webspaces");
    const packet = kind === "subdomain"
      ? xmlPacket("  <subdomain>\n    <get>\n      <filter/>\n    </get>\n  </subdomain>")
      : xmlPacket(`  <${kind}>\n    <get>\n      <filter/>\n      <dataset>\n        <gen_info/>\n      </dataset>\n    </get>\n  </${kind}>`);
    return { request: packet, response: await this.sendRaw(packet) };
  }
}
