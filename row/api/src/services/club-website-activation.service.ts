import { Injectable } from "@nestjs/common";
import type { DbCommands } from "../database/db.service";
import { AppConfig } from "../config/app-config";
import { Brand } from "../brand/brand";
import { EmailService } from "./email.service";
import { PleskService } from "./plesk.service";
import { ClubSiteCachePurger } from "./club-site-cache-purger";
import { normalizeSubdomain } from "./website-domain.helper";

export interface ClubWebsiteActivationResult {
  skipPlesk: boolean;
  notFound: boolean;
  noSubdomain: boolean;
  activationFailed: boolean;
  pleskError: string | null;
  pleskStepsDone: string[];
  emailsSent: number;
  emailsTotal: number;
}

export async function logWebsiteAction(conn: DbCommands, websiteId: number, action: string, details: string | null, userId: number) {
  await conn.execute("INSERT INTO club_website_logs (fk_website_id, Action, Details, PerformedBy) VALUES (@W, @A, @D, @U)", { W: websiteId, A: action, D: details, U: userId });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Port of ClubWebsiteActivationService.cs: provisions a club_websites row in
 * Plesk (create / reuse subdomain, docroot, alias, wildcard SSL), sets it
 * Active and emails the club President / Secretary. RIZones copied its own
 * vendor mailbox on that email; ROW copies Brand support.internalCc.
 */
@Injectable()
export class ClubWebsiteActivationService {
  constructor(
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly plesk: PleskService,
    private readonly purger: ClubSiteCachePurger,
  ) {}

  async activate(conn: DbCommands, id: number, userId: number, skipPlesk: boolean, logAction: string): Promise<ClubWebsiteActivationResult> {
    const result: ClubWebsiteActivationResult = {
      skipPlesk, notFound: false, noSubdomain: false, activationFailed: false, pleskError: null, pleskStepsDone: [], emailsSent: 0, emailsTotal: 0,
    };
    const website = await conn.queryFirstOrDefault(
      `SELECT w.pk_id AS id, w.fk_club_id AS clubId, c.ClubName AS clubName, w.Subdomain AS subdomain, w.ClientDomain AS clientDomain,
              w.StartDate AS startDate, w.EndDate AS endDate, w.Status AS status
       FROM club_websites w JOIN club_master c ON c.pk_club_id = w.fk_club_id
       WHERE w.pk_id = @Id AND w.isdeleted = 0`,
      { Id: id },
    );
    if (!website) {
      result.notFound = true;
      return result;
    }
    const parent = this.config.get("PleskSettings:ParentDomain") ?? "";
    // Plesk gets the bare first label: a stored FQDN must not get the parent appended twice.
    const label = normalizeSubdomain(String(website.subdomain ?? ""));
    const fullSub = `${label}.${parent.toLowerCase()}`;
    if (!skipPlesk && this.plesk.isConfigured && !label.trim()) {
      result.noSubdomain = true;
      return result;
    }
    const steps = result.pleskStepsDone;
    let pleskError: string | null = null;
    const clientDomain = typeof website.clientDomain === "string" && website.clientDomain.trim() ? website.clientDomain : null;

    if (!skipPlesk && this.plesk.isConfigured) {
      try {
        if (await this.plesk.subdomainExists(label)) {
          steps.push(`Subdomain already existed (${label}.${parent}) — reusing`);
          await logWebsiteAction(conn, id, "PleskSubdomainReused", `${label}.${parent} already existed`, userId);
          // a leftover subdomain keeps Plesk's default docroot: re-point it to the shared folder
          if (this.plesk.clubSharedDocroot) {
            try {
              await this.plesk.setSubdomainDocroot(label, this.plesk.clubSharedDocroot);
              steps.push(`Docroot re-pointed to shared folder (${this.plesk.clubSharedDocroot})`);
              await logWebsiteAction(conn, id, "PleskDocrootRepointed", this.plesk.clubSharedDocroot, userId);
            } catch (e) {
              await logWebsiteAction(conn, id, "PleskDocrootRebindFailed", message(e), userId);
            }
          }
        } else {
          await this.plesk.createSubdomain(label);
          steps.push(`Subdomain created (${label}.${parent})`);
          await logWebsiteAction(conn, id, "PleskSubdomainCreated", `${label}.${parent}`, userId);
        }
        if (clientDomain) {
          try {
            if (await this.plesk.domainAliasExists(clientDomain)) {
              steps.push(`Domain already an application (${clientDomain}) — reusing`);
              await logWebsiteAction(conn, id, "PleskAliasAlreadyExists", clientDomain, userId);
            } else {
              await this.plesk.addDomainAlias(fullSub, clientDomain);
              steps.push(`Alias added (${clientDomain})`);
              await logWebsiteAction(conn, id, "PleskAliasAdded", clientDomain, userId);
            }
            const le = await this.plesk.tryProvisionLetsEncryptForDomain(clientDomain);
            steps.push(le ? `SSL issued (${clientDomain})` : `SSL pending (${clientDomain})`);
            await logWebsiteAction(conn, id, le ? "PleskDomainLetsEncrypt" : "PleskDomainLetsEncryptFailed", clientDomain, userId);
            await conn.execute("UPDATE club_websites SET ClientDomainProvisioned = 1, ClientDomainVerifiedDate = NOW() WHERE pk_id = @Id", { Id: id });
          } catch (e) {
            await logWebsiteAction(conn, id, "PleskAliasFailed", message(e), userId);
            pleskError = `Alias failed: ${message(e)}`;
          }
        }
        if (this.plesk.WildcardCertName) {
          try {
            await this.plesk.assignCertificate(label, this.plesk.WildcardCertName);
            steps.push(`Wildcard cert assigned (${this.plesk.WildcardCertName})`);
            await logWebsiteAction(conn, id, "PleskCertAssigned", this.plesk.WildcardCertName, userId);
          } catch (e) {
            await logWebsiteAction(conn, id, "PleskCertFailed", message(e), userId);
          }
        } else {
          await logWebsiteAction(conn, id, "PleskCertSkipped", "WildcardCertName not configured", userId);
        }
      } catch (e) {
        pleskError = message(e);
        await logWebsiteAction(conn, id, "PleskActivationFailed", pleskError, userId);
        await conn.execute("UPDATE club_websites SET Status = 'ActivationFailed', modified_by = @U WHERE pk_id = @Id", { Id: id, U: userId });
        result.activationFailed = true;
        result.pleskError = pleskError;
        return result;
      }
    } else if (!skipPlesk) {
      await logWebsiteAction(conn, id, "PleskSkippedNotConfigured", "PleskSettings.ApiKey not set — skipped provisioning", userId);
    } else {
      await logWebsiteAction(conn, id, "PleskSkippedManualOverride", "Admin chose manual activation", userId);
    }

    await conn.execute("UPDATE club_websites SET Status = 'Active', modified_by = @U WHERE pk_id = @Id", { Id: id, U: userId });
    await logWebsiteAction(conn, id, logAction, "Status set to Active", userId);

    const yearId = await conn.executeScalar<number>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
    if (yearId !== null && yearId !== undefined) {
      const leaders = await conn.query(
        `SELECT m.MemberName AS memberName, m.EmailId AS email, d.designation_name AS designation
         FROM board_of_directors b
         JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
         JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
         WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
           AND d.designation_name IN ('Club President', 'Club Secretary') AND m.EmailId IS NOT NULL AND m.EmailId <> ''`,
        { ClubId: website.clubId, YearId: yearId },
      );
      result.emailsTotal = leaders.length;
      const cc = Brand.Current.support.internalCc.length ? Brand.Current.support.internalCc.join(",") : null;
      for (const l of leaders) {
        try {
          await this.email.sendClubWebsiteActivationEmail(String(l.email), String(l.memberName ?? ""), String(website.clubName ?? ""), String(l.designation), fullSub, clientDomain, String(website.startDate), String(website.endDate), cc);
          result.emailsSent++;
        } catch {
          // logged by the email service
        }
      }
      await logWebsiteAction(conn, id, "ActivationEmailSent", `Sent to ${result.emailsSent} of ${result.emailsTotal} leaders`, userId);
    }
    this.purger.purgeByClub(Number(website.clubId));
    result.pleskError = pleskError;
    return result;
  }
}
