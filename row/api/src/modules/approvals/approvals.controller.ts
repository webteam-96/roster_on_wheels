import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { BeneficiaryApprovalService, type ApprovalDetail } from "./beneficiary-approval.service";
import { Db } from "../../database/db.service";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, content, forbid, notFound, ok, statusCode } from "../../common/results";
import { bodyField, paramInt, queryInt, queryString } from "../../common/binding";
import { formatDate, formatNumber } from "../../common/dotnet-format";
import { Brand } from "../../brand/brand";
import { DISTRICT_BLOCKED_MESSAGE, isDistrictDrillReachable } from "../../services/kill-switch.helper";

const esc = (s: string) => s.replace(/&/g, "&amp;");

export function page(title: string, body: string, color: string) {
  const team = esc(Brand.Current.productName);
  return content(
    `<!DOCTYPE html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>${title} - ${team}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f7fafc; }
  .container { max-width: 600px; margin: 40px auto; padding: 32px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  h1 { color: ${color}; margin-bottom: 16px; }
  p { color: #4a5568; line-height: 1.6; }
  .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }
</style></head><body>
<div class='container'>
  <h1>${title}</h1>
  ${body}
  <div class='footer'>Thank you,<br/><strong>Team ${team}</strong></div>
</div></body></html>`,
    "text/html",
  );
}

const alreadyProcessed = (status: string, remark: string | null = null) =>
  page(
    "Already Processed",
    `<p>This request has already been <strong>${status}</strong>.</p>` + (remark ? `<p><strong>Remark:</strong> ${remark}</p>` : ""),
    status === "approved" ? "#38a169" : "#e53e3e",
  );

function formPage(token: string, d: ApprovalDetail, action: "approve" | "reject", errorMessage: string | null = null) {
  const approve = action === "approve";
  const label = approve ? "Approve" : "Reject";
  const team = esc(Brand.Current.productName);
  const v = (x: number | null) => (x === null || x === undefined ? "—" : String(x));
  const row = (k: string, val: string) => `<tr><td>${k}</td><td>${val}</td></tr>`;
  return content(
    `<!DOCTYPE html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>${label} Project - ${team}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f7fafc; }
  .container { max-width: 650px; margin: 40px auto; padding: 32px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  h1 { color: #1a365d; margin-bottom: 8px; }
  h2 { color: #2d3748; font-size: 18px; margin-top: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  td { padding: 8px; border: 1px solid #e2e8f0; }
  tr:nth-child(odd) { background: #f7fafc; }
  td:first-child { font-weight: bold; width: 40%; }
  .highlight { background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px; padding: 16px; margin: 12px 0; }
  textarea { width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-family: Arial; font-size: 14px; resize: vertical; box-sizing: border-box; }
  .btn { padding: 14px 32px; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; color: white; background: ${approve ? "#38a169" : "#e53e3e"}; }
  .btn:hover { opacity: 0.9; }
  .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }
</style></head><body>
<div class='container'>
  <h1>${label} Beneficiary Request</h1>
  <p style='color: #718096;'>Project submitted with beneficiaries exceeding the set limit.</p>
  ${errorMessage ? `<div style='background: #fff5f5; border: 1px solid #feb2b2; padding: 12px; border-radius: 6px; color: #e53e3e; margin-bottom: 16px;'>${errorMessage}</div>` : ""}
  <h2>Project Details</h2>
  <table>
    ${row("Project Title", d.projectTitle)}
    ${row("Description", d.projectDescription ?? "—")}
    ${row("Project Date", d.projectDate ? formatDate(d.projectDate, "dd-MMM-yyyy") : "—")}
    ${row("Project Cost", d.projectCost === null ? "—" : formatNumber(d.projectCost, "N2"))}
    ${row("Man Hours", v(d.manHours))}
    ${row("Rotarians Involved", v(d.rotariansInvolved))}
    ${row("Rotaractors Involved", v(d.rotaractorsInvolved))}
    ${row("RCC Involved", v(d.rccInvolved))}
  </table>
  <h2>Beneficiary Details</h2>
  <div class='highlight'>
    <p><strong>Set Limit:</strong> ${d.currentLimit}</p>
    <p><strong>Requested Beneficiaries:</strong> <span style='color: #e53e3e; font-weight: bold;'>${d.requestedBeneficiaries}</span></p>
  </div>
  ${d.photoUrls.length ? `
  <h2>Project Photos</h2>
  <div style='margin: 12px 0; display: flex; flex-wrap: wrap; gap: 8px;'>
    ${d.photoUrls.map((u) => `<img src='${u}' alt='Project Photo' style='max-width: 200px; height: 150px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0;' />`).join("")}
  </div>` : ""}
  <h2>Club & Admin Details</h2>
  <table>
    ${row("District", d.districtNumber)}
    ${row("Club", d.clubName)}
    ${row("Admin Name", d.requestedByName)}
    ${row("Admin Mobile", d.requestedByMobile)}
    ${row("Admin Email", d.requestedByEmail)}
  </table>
  <form method='POST' action='/api/beneficiary-approval/${token}/${action}' style='margin-top: 24px;'>
    <h2>Remark ${approve ? "(Optional)" : "(Required)"}</h2>
    <textarea name='remark' rows='3' placeholder='Enter your remark here...' ${approve ? "" : "required"}></textarea>
    <div style='margin-top: 16px; text-align: center;'>
      <button type='submit' class='btn'>Confirm ${label}</button>
    </div>
  </form>
  <div class='footer'>Thank you,<br/><strong>Team ${team}</strong></div>
</div></body></html>`,
    "text/html",
  );
}

/**
 * Port of BeneficiaryApprovalController.cs: api/beneficiary-approval. The
 * approve / reject pages are opened from the Zonal Co-ordinator's email and
 * need no sign-in (the token is the credential).
 */
@Controller("api/beneficiary-approval")
export class BeneficiaryApprovalController {
  constructor(private readonly approvals: BeneficiaryApprovalService) {}

  @Post("request")
  @Authorize()
  async create(@Body() body: unknown, @User() user: CurrentUser) {
    try {
      const memberId = parseInt(user.findFirst("memberId") ?? "0", 10);
      const n = (k: string) => Number(bodyField(body, k) ?? 0) || 0;
      const id = await this.approvals.createApprovalRequest(n("projectId"), n("clubId"), n("requestedBeneficiaries"), 0, memberId);
      return ok({ id, message: "Approval request sent to Zonal Coordinator." });
    } catch (e) {
      return statusCode(500, { message: `Failed to create approval request: ${(e as Error).message}` });
    }
  }

  private async showForm(token: string, action: "approve" | "reject") {
    const d = (await this.approvals.getByToken(token)) as ApprovalDetail | null;
    if (!d) return page("Request Not Found", "<p>This approval request was not found.</p>", "#e53e3e");
    if (d.status !== "pending") return alreadyProcessed(d.status, d.remark);
    return formPage(token, d, action);
  }

  @Get(":token/approve")
  @AllowAnonymous()
  showApprove(@Param("token") token: string) {
    return this.showForm(token, "approve");
  }

  @Get(":token/reject")
  @AllowAnonymous()
  showReject(@Param("token") token: string) {
    return this.showForm(token, "reject");
  }

  @Post(":token/approve")
  @AllowAnonymous()
  async processApprove(@Param("token") token: string, @Body() body: unknown) {
    try {
      const [status, result] = await this.approvals.approve(token, (bodyField(body, "remark") as string | undefined) ?? null);
      if (result === "already_processed") return alreadyProcessed(status);
      return page("Approved Successfully", "<p>The project has been approved. Beneficiaries have been updated as per the request.</p>", "#38a169");
    } catch (e) {
      return page("Error", `<p>Failed to process approval: ${(e as Error).message}</p>`, "#e53e3e");
    }
  }

  @Post(":token/reject")
  @AllowAnonymous()
  async processReject(@Param("token") token: string, @Body() body: unknown) {
    const remark = bodyField(body, "remark") as string | undefined;
    if (!remark || !remark.trim()) {
      const d = (await this.approvals.getByToken(token)) as ApprovalDetail | null;
      if (!d) return page("Request Not Found", "<p>This approval request was not found.</p>", "#e53e3e");
      if (d.status !== "pending") return alreadyProcessed(d.status);
      return formPage(token, d, "reject", "Remark is required when rejecting.");
    }
    try {
      const [status, result] = await this.approvals.reject(token, remark);
      if (result === "already_processed") return alreadyProcessed(status);
      return page("Rejected", "<p>The project has been rejected. Beneficiaries will remain at the set limit.</p>", "#e53e3e");
    } catch (e) {
      return page("Error", `<p>Failed to process rejection: ${(e as Error).message}</p>`, "#e53e3e");
    }
  }
}

const NO_ZONE = { message: "No zone assigned." };
const NOT_FOUND = { message: "Approval request not found." };

/** Port of ZonalDashboardController.cs: api/zonal-dashboard (Zonal Co-ordinator, or SuperAdmin by zone id). */
@Controller("api/zonal-dashboard")
@Authorize()
export class ZonalDashboardController {
  constructor(
    private readonly approvals: BeneficiaryApprovalService,
    private readonly db: Db,
  ) {}

  private memberId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);
  private isZc = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("ZonalCoordinator");
  private isSa = (u: CurrentUser) => (u.findFirst("roles") ?? "").includes("SuperAdmin");
  private zoneOf = (u: CurrentUser) => this.approvals.getZoneForMember(this.memberId(u));
  private async zoneOfApproval(approvalId: number) {
    return Number((await this.db.executeScalar("SELECT fk_zone_id FROM beneficiary_approval_requests WHERE pk_approval_id = @Id", { Id: approvalId })) ?? 0);
  }

  @Get("zone-info")
  async zoneInfo(@User() u: CurrentUser) {
    if (!this.isZc(u)) return forbid();
    const info = await this.zoneOf(u);
    return info ? ok(info) : notFound(NO_ZONE);
  }

  @Get("zone/:zoneId/info")
  async zoneInfoById(@Param("zoneId") z: string, @User() u: CurrentUser) {
    const zoneId = paramInt(z, "zoneId");
    if (!this.isSa(u)) return forbid();
    const info = await this.approvals.getZoneInfoById(zoneId);
    return info ? ok(info) : notFound({ message: "Zone not found." });
  }

  @Get("approval-requests")
  async requests(
    @User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("status") s?: string,
    @Query("page") p?: string, @Query("pageSize") ps?: string,
  ) {
    const [districtId, yearId, pageNo, pageSize] = [queryInt(d, 0), queryInt(y, 0), queryInt(p, 1), queryInt(ps, 20)];
    if (!this.isZc(u)) return forbid();
    const zone = await this.zoneOf(u);
    if (!zone) return notFound(NO_ZONE);
    const { items, totalCount } = await this.approvals.getApprovalRequestsByZone(zone.zoneId as number, districtId, yearId, queryString(s), pageNo, pageSize);
    return ok({ items, totalCount, page: pageNo, pageSize });
  }

  @Get("approval-filters")
  async filters(@User() u: CurrentUser) {
    if (!this.isZc(u)) return forbid();
    const zone = await this.zoneOf(u);
    return zone ? ok(await this.approvals.getZoneApprovalFilters(zone.zoneId as number)) : notFound(NO_ZONE);
  }

  @Get("zone/:zoneId/approval-requests")
  async zoneRequests(
    @Param("zoneId") z: string, @User() u: CurrentUser, @Query("districtId") d?: string, @Query("yearId") y?: string, @Query("status") s?: string,
    @Query("page") p?: string, @Query("pageSize") ps?: string,
  ) {
    const zoneId = paramInt(z, "zoneId");
    const [districtId, yearId, pageNo, pageSize] = [queryInt(d, 0), queryInt(y, 0), queryInt(p, 1), queryInt(ps, 20)];
    if (!this.isSa(u)) return forbid();
    const { items, totalCount } = await this.approvals.getApprovalRequestsByZone(zoneId, districtId, yearId, queryString(s), pageNo, pageSize);
    return ok({ items, totalCount, page: pageNo, pageSize });
  }

  @Get("zone/:zoneId/approval-filters")
  async zoneFilters(@Param("zoneId") z: string, @User() u: CurrentUser) {
    const zoneId = paramInt(z, "zoneId");
    if (!this.isSa(u)) return forbid();
    return ok(await this.approvals.getZoneApprovalFilters(zoneId));
  }

  @Get("approval-requests/:token/detail")
  async detail(@Param("token") token: string, @User() u: CurrentUser) {
    if (!this.isZc(u) && !this.isSa(u)) return forbid();
    const d = (await this.approvals.getByToken(token)) as ApprovalDetail | null;
    if (!d) return notFound(NOT_FOUND);
    if (this.isZc(u) && !this.isSa(u)) {
      const zone = await this.zoneOf(u);
      if (!zone || d.zoneId !== zone.zoneId) return notFound(NOT_FOUND);
    }
    return ok(d);
  }

  @Get("approval-history/:approvalId")
  async history(@Param("approvalId") a: string, @User() u: CurrentUser) {
    const approvalId = paramInt(a, "approvalId");
    if (!this.isZc(u) && !this.isSa(u)) return forbid();
    let zoneId: number;
    if (this.isZc(u) && !this.isSa(u)) {
      const zone = await this.zoneOf(u);
      if (!zone) return notFound(NO_ZONE);
      zoneId = zone.zoneId as number;
    } else {
      zoneId = await this.zoneOfApproval(approvalId);
      if (zoneId === 0) return notFound(NOT_FOUND);
    }
    return ok(await this.approvals.getApprovalHistory(approvalId, zoneId));
  }

  /** The co-ordinator acts in their own zone; a SuperAdmin (without the ZC role) acts in the request's zone. */
  private async actingZone(u: CurrentUser, approvalId: number) {
    if (this.isZc(u)) {
      const zone = await this.zoneOf(u);
      return zone ? { zoneId: zone.zoneId as number } : { error: notFound(NO_ZONE) };
    }
    const zoneId = await this.zoneOfApproval(approvalId);
    return zoneId ? { zoneId } : { error: notFound(NOT_FOUND) };
  }

  @Post("approve")
  async approve(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isZc(u) && !this.isSa(u)) return forbid();
    const approvalId = Number(bodyField(body, "approvalId") ?? 0) || 0;
    const remark = (bodyField(body, "remark") as string | null | undefined) ?? null;
    const approvedRaw = bodyField(body, "approvedBeneficiaries");
    const approved = approvedRaw === null || approvedRaw === undefined || approvedRaw === "" ? null : Number(approvedRaw);
    const acting = await this.actingZone(u, approvalId);
    if ("error" in acting) return acting.error;
    const [status, result] = await this.approvals.zonalApprove(approvalId, acting.zoneId, this.memberId(u), remark, approved);
    if (result === "error") return notFound(NOT_FOUND);
    if (result === "already_processed") return badRequest({ message: `Request has already been ${status}.` });
    return ok({ message: "Approved successfully. Beneficiaries updated." });
  }

  @Post("reject")
  async reject(@Body() body: unknown, @User() u: CurrentUser) {
    if (!this.isZc(u) && !this.isSa(u)) return forbid();
    const remark = bodyField(body, "remark") as string | null | undefined;
    if (!remark || !remark.trim()) return badRequest({ message: "Remark is required when rejecting." });
    const approvalId = Number(bodyField(body, "approvalId") ?? 0) || 0;
    const acting = await this.actingZone(u, approvalId);
    if ("error" in acting) return acting.error;
    const [status, result] = await this.approvals.zonalReject(approvalId, acting.zoneId, this.memberId(u), remark);
    if (result === "error") return notFound(NOT_FOUND);
    if (result === "already_processed") return badRequest({ message: `Request has already been ${status}.` });
    return ok({ message: "Rejected successfully." });
  }

  @Get("districts")
  async districts(@User() u: CurrentUser) {
    if (!this.isZc(u)) return forbid();
    const zone = await this.zoneOf(u);
    return zone ? ok(await this.approvals.getZoneDistricts(zone.zoneId as number)) : notFound(NO_ZONE);
  }

  @Get("zone/:zoneId/districts")
  async zoneDistricts(@Param("zoneId") z: string, @User() u: CurrentUser) {
    const zoneId = paramInt(z, "zoneId");
    if (!this.isSa(u)) return forbid();
    return ok(await this.approvals.getZoneDistricts(zoneId));
  }

  @Get("districts/:districtId/clubs")
  async clubs(@Param("districtId") d: string, @User() u: CurrentUser) {
    const districtId = paramInt(d, "districtId");
    if (!(await isDistrictDrillReachable(this.db, districtId))) return statusCode(403, { message: DISTRICT_BLOCKED_MESSAGE });
    if (!this.isZc(u) && !this.isSa(u)) return forbid();
    if (this.isZc(u) && !this.isSa(u)) {
      const zone = await this.zoneOf(u);
      if (!zone) return notFound(NO_ZONE);
      const districts = await this.approvals.getZoneDistricts(zone.zoneId as number);
      if (!districts.some((x) => x.id === districtId)) return forbid();
    }
    return ok(await this.approvals.getDistrictClubs(districtId));
  }
}
