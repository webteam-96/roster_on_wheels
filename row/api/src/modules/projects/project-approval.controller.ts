import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ProjectApprovalService } from "./project-approval.service";
import type { Row } from "../../database/db.service";
import { AllowAnonymous, Authorize, User } from "../../auth/decorators";
import type { CurrentUser } from "../../auth/current-user";
import { badRequest, content, notFound, ok } from "../../common/results";
import { bodyField, paramInt, queryInt, queryString } from "../../common/binding";
import { formatDate, formatNumber } from "../../common/dotnet-format";
import { Brand } from "../../brand/brand";
import { page } from "../approvals/approvals.controller";

const NOT_FOUND_PAGE = () => page("Request Not Found", "<p>This project approval request was not found.</p>", "#e53e3e");
const processed = (d: Row, withRemark = true) =>
  page(
    "Already Processed",
    `<p>This project has already been <strong>${d.approvalStatus}</strong>.</p>` + (withRemark && d.approvalRemark ? `<p><strong>Remark:</strong> ${d.approvalRemark}</p>` : ""),
    d.approvalStatus === "approved" ? "#38a169" : "#e53e3e",
  );

/** The approve / reject form posted back to the same URL (empty action keeps any deployment sub-path). */
function formPage(d: Row, action: "approve" | "reject", errorMessage: string | null = null) {
  const approve = action === "approve";
  const color = approve ? "#38a169" : "#e53e3e";
  const label = approve ? "Approve" : "Reject";
  const team = Brand.Current.productName.replace(/&/g, "&amp;");
  const cost = d.projectCost !== null && d.projectCost !== undefined ? formatNumber(Number(d.projectCost), "C") : "—";
  return content(
    `<!DOCTYPE html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>${label} Project - ${team}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f7fafc; }
  .container { max-width: 600px; margin: 40px auto; padding: 32px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  h1 { color: ${color}; margin-bottom: 16px; }
  .detail { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
  .detail table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .detail td { padding: 6px 0; }
  .detail td:first-child { color: #718096; width: 40%; }
  .error { color: #e53e3e; background: #fed7d7; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; }
  textarea { width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-family: inherit; resize: vertical; box-sizing: border-box; }
  button { background: ${color}; color: white; border: none; padding: 12px 32px; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; }
  button:hover { opacity: 0.9; }
  .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }
</style></head><body>
<div class='container'>
  <h1>${label} Project</h1>
  <div class='detail'>
    <table>
      <tr><td>Project</td><td><strong>${d.title ?? ""}</strong></td></tr>
      <tr><td>Module</td><td>${d.moduleName ?? ""}</td></tr>
      <tr><td>Club</td><td>${d.clubName ?? ""}</td></tr>
      <tr><td>District</td><td>${d.districtNumber ?? ""}</td></tr>
      <tr><td>Date</td><td>${d.projectDate ? formatDate(d.projectDate, "dd MMM yyyy") : "—"}</td></tr>
      <tr><td>Cost</td><td>${cost}</td></tr>
      <tr><td>Submitted By</td><td>${d.submittedByName ?? ""}</td></tr>
    </table>
  </div>
  ${errorMessage ? `<div class='error'>${errorMessage}</div>` : ""}
  <form method='POST' action=''>
    <div style='margin-bottom: 16px;'>
      <label style='font-weight: 600; display: block; margin-bottom: 4px;'>Remark ${approve ? "(Optional)" : "(Required)"}</label>
      <textarea name='remark' rows='3' ${approve ? "" : "required"} placeholder='Enter your remark...'></textarea>
    </div>
    <button type='submit'>${label} Project</button>
  </form>
  <div class='footer'>Thank you,<br/><strong>Team ${team}</strong></div>
</div></body></html>`,
    "text/html",
  );
}

/** Port of ProjectApprovalController.cs: moderator approval links (anonymous, token) and the moderator's screens. */
@Controller("api/project-approval")
export class ProjectApprovalController {
  constructor(private readonly approvals: ProjectApprovalService) {}

  private memberId = (u: CurrentUser) => parseInt(u.findFirst("memberId") ?? "0", 10);

  private async showForm(token: string, action: "approve" | "reject") {
    const d = await this.approvals.getByToken(token);
    if (!d) return NOT_FOUND_PAGE();
    if (d.approvalStatus !== "pending") return processed(d);
    return formPage(d, action);
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
  async approve(@Param("token") token: string, @Body() body: unknown) {
    try {
      const r = await this.approvals.approveByToken(token, (bodyField(body, "remark") as string | undefined) ?? null);
      return r.success ? page("Project Approved", "<p>The project has been approved successfully.</p>", "#38a169") : page("Cannot Process", `<p>${r.message}</p>`, "#e53e3e");
    } catch (e) {
      return page("Error", `<p>Failed to process approval: ${(e as Error).message}</p>`, "#e53e3e");
    }
  }

  @Post(":token/reject")
  @AllowAnonymous()
  async reject(@Param("token") token: string, @Body() body: unknown) {
    const remark = (bodyField(body, "remark") as string | undefined) ?? "";
    if (!remark.trim()) {
      const d = await this.approvals.getByToken(token);
      if (!d) return NOT_FOUND_PAGE();
      if (d.approvalStatus !== "pending") return processed(d, false);
      return formPage(d, "reject", "Remark is required when rejecting.");
    }
    try {
      const r = await this.approvals.rejectByToken(token, remark);
      return r.success ? page("Project Rejected", "<p>The project has been rejected.</p>", "#e53e3e") : page("Cannot Process", `<p>${r.message}</p>`, "#e53e3e");
    } catch (e) {
      return page("Error", `<p>Failed to process rejection: ${(e as Error).message}</p>`, "#e53e3e");
    }
  }

  @Get("moderator/years")
  @Authorize()
  async years(@User() u: CurrentUser) {
    return ok(await this.approvals.getYearSummary(this.memberId(u)));
  }

  @Get("moderator/projects")
  @Authorize()
  async projects(
    @User() u: CurrentUser, @Query("yearId") y?: string, @Query("status") status?: string, @Query("page") p?: string, @Query("pageSize") ps?: string,
    @Query("moduleKey") moduleKey?: string,
  ) {
    const [yearId, pageNo, pageSize] = [queryInt(y, 0), queryInt(p, 1), queryInt(ps, 20)];
    const { items, totalCount } = await this.approvals.getProjectsForModerator(this.memberId(u), yearId, queryString(status), pageNo, pageSize, queryString(moduleKey));
    return ok({ items, totalCount, page: pageNo, pageSize, totalPages: Math.ceil(totalCount / pageSize) });
  }

  @Get("moderator/:projectId/detail")
  @Authorize()
  async detail(@Param("projectId") p: string, @User() u: CurrentUser, @Query("yearId") y?: string) {
    const projectId = paramInt(p, "projectId");
    const r = await this.approvals.getProjectDetailForModerator(projectId, this.memberId(u), queryInt(y));
    return r ? ok(r) : notFound({ message: "Project not found or you are not the moderator for this club." });
  }

  @Post("moderator/:projectId/approve")
  @Authorize()
  async moderatorApprove(@Param("projectId") p: string, @Body() body: unknown, @User() u: CurrentUser, @Query("yearId") y?: string) {
    const remark = bodyField(body, "remark");
    const r = await this.approvals.moderatorApprove(paramInt(p, "projectId"), this.memberId(u), remark === undefined || remark === null ? null : String(remark), queryInt(y));
    return r.success ? ok({ message: r.message }) : badRequest({ message: r.message });
  }

  @Post("moderator/:projectId/reject")
  @Authorize()
  async moderatorReject(@Param("projectId") p: string, @Body() body: unknown, @User() u: CurrentUser, @Query("yearId") y?: string) {
    const r = await this.approvals.moderatorReject(paramInt(p, "projectId"), this.memberId(u), String(bodyField(body, "remark") ?? ""), queryInt(y));
    return r.success ? ok({ message: r.message }) : badRequest({ message: r.message });
  }
}
