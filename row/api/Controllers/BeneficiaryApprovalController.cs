using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/beneficiary-approval")]
public class BeneficiaryApprovalController : ControllerBase
{
    private readonly IBeneficiaryApprovalService _approvalService;

    public BeneficiaryApprovalController(IBeneficiaryApprovalService approvalService)
    {
        _approvalService = approvalService;
    }

    /// <summary>
    /// Called from frontend when admin confirms over-limit project.
    /// </summary>
    [HttpPost("request")]
    [Authorize]
    public async Task<ActionResult> CreateRequest([FromBody] BeneficiaryApprovalRequestDto dto)
    {
        try
        {
            var memberId = int.Parse(User.FindFirst("memberId")?.Value ?? "0");
            var id = await _approvalService.CreateApprovalRequestAsync(
                dto.ProjectId, dto.ClubId, dto.RequestedBeneficiaries, 0, memberId);
            return Ok(new { id, message = "Approval request sent to Zonal Coordinator." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to create approval request: {ex.Message}" });
        }
    }

    /// <summary>
    /// Zonal coordinator clicks Approve link from email — shows HTML form page.
    /// </summary>
    [HttpGet("{token}/approve")]
    [AllowAnonymous]
    public async Task<ContentResult> ShowApprovePage(string token)
    {
        var detail = await _approvalService.GetByTokenAsync(token);
        if (detail == null)
            return HtmlPage("Request Not Found", "<p>This approval request was not found.</p>", "#e53e3e");

        if (detail.Status != "pending")
            return HtmlPage(
                "Already Processed",
                $"<p>This request has already been <strong>{detail.Status}</strong>.</p>" +
                (string.IsNullOrEmpty(detail.Remark) ? "" : $"<p><strong>Remark:</strong> {detail.Remark}</p>"),
                detail.Status == "approved" ? "#38a169" : "#e53e3e");

        var html = ApprovalFormHtml(token, detail, "approve");
        return new ContentResult { Content = html, ContentType = "text/html", StatusCode = 200 };
    }

    /// <summary>
    /// Zonal coordinator clicks Reject link from email — shows HTML form page.
    /// </summary>
    [HttpGet("{token}/reject")]
    [AllowAnonymous]
    public async Task<ContentResult> ShowRejectPage(string token)
    {
        var detail = await _approvalService.GetByTokenAsync(token);
        if (detail == null)
            return HtmlPage("Request Not Found", "<p>This approval request was not found.</p>", "#e53e3e");

        if (detail.Status != "pending")
            return HtmlPage(
                "Already Processed",
                $"<p>This request has already been <strong>{detail.Status}</strong>.</p>" +
                (string.IsNullOrEmpty(detail.Remark) ? "" : $"<p><strong>Remark:</strong> {detail.Remark}</p>"),
                detail.Status == "approved" ? "#38a169" : "#e53e3e");

        var html = ApprovalFormHtml(token, detail, "reject");
        return new ContentResult { Content = html, ContentType = "text/html", StatusCode = 200 };
    }

    /// <summary>
    /// Form POST from the approve page.
    /// </summary>
    [HttpPost("{token}/approve")]
    [AllowAnonymous]
    public async Task<ContentResult> ProcessApprove(string token, [FromForm] string? remark)
    {
        try
        {
            var (status, result) = await _approvalService.ApproveAsync(token, remark);
            if (result == "already_processed")
                return HtmlPage("Already Processed",
                    $"<p>This request has already been <strong>{status}</strong>.</p>",
                    status == "approved" ? "#38a169" : "#e53e3e");

            return HtmlPage("Approved Successfully",
                "<p>The project has been approved. Beneficiaries have been updated as per the request.</p>",
                "#38a169");
        }
        catch (Exception ex)
        {
            return HtmlPage("Error", $"<p>Failed to process approval: {ex.Message}</p>", "#e53e3e");
        }
    }

    /// <summary>
    /// Form POST from the reject page.
    /// </summary>
    [HttpPost("{token}/reject")]
    [AllowAnonymous]
    public async Task<ContentResult> ProcessReject(string token, [FromForm] string? remark)
    {
        if (string.IsNullOrWhiteSpace(remark))
        {
            var detail = await _approvalService.GetByTokenAsync(token);
            if (detail == null)
                return HtmlPage("Request Not Found", "<p>This approval request was not found.</p>", "#e53e3e");
            if (detail.Status != "pending")
                return HtmlPage("Already Processed",
                    $"<p>This request has already been <strong>{detail.Status}</strong>.</p>",
                    detail.Status == "approved" ? "#38a169" : "#e53e3e");

            var html = ApprovalFormHtml(token, detail, "reject",
                errorMessage: "Remark is required when rejecting.");
            return new ContentResult { Content = html, ContentType = "text/html", StatusCode = 200 };
        }

        try
        {
            var (status, result) = await _approvalService.RejectAsync(token, remark);
            if (result == "already_processed")
                return HtmlPage("Already Processed",
                    $"<p>This request has already been <strong>{status}</strong>.</p>",
                    status == "approved" ? "#38a169" : "#e53e3e");

            return HtmlPage("Rejected",
                "<p>The project has been rejected. Beneficiaries will remain at the set limit.</p>",
                "#e53e3e");
        }
        catch (Exception ex)
        {
            return HtmlPage("Error", $"<p>Failed to process rejection: {ex.Message}</p>", "#e53e3e");
        }
    }

    private static ContentResult HtmlPage(string title, string bodyContent, string color)
    {
        var html = $@"<!DOCTYPE html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>{title} - Rotary Zones</title>
<style>
  body {{ font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f7fafc; }}
  .container {{ max-width: 600px; margin: 40px auto; padding: 32px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  h1 {{ color: {color}; margin-bottom: 16px; }}
  p {{ color: #4a5568; line-height: 1.6; }}
  .footer {{ margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }}
</style></head><body>
<div class='container'>
  <h1>{title}</h1>
  {bodyContent}
  <div class='footer'>Thank you,<br/><strong>Team ROW</strong></div>
</div></body></html>";
        return new ContentResult { Content = html, ContentType = "text/html", StatusCode = 200 };
    }

    private static string ApprovalFormHtml(string token, BeneficiaryApprovalDetailDto d, string action, string? errorMessage = null)
    {
        var isApprove = action == "approve";
        var actionColor = isApprove ? "#38a169" : "#e53e3e";
        var actionLabel = isApprove ? "Approve" : "Reject";
        var remarkRequired = isApprove ? "" : "required";
        var remarkNote = isApprove ? "(Optional)" : "(Required)";
        var errorHtml = string.IsNullOrEmpty(errorMessage) ? "" :
            $"<div style='background: #fff5f5; border: 1px solid #feb2b2; padding: 12px; border-radius: 6px; color: #e53e3e; margin-bottom: 16px;'>{errorMessage}</div>";

        return $@"<!DOCTYPE html>
<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>{actionLabel} Project - Rotary Zones</title>
<style>
  body {{ font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f7fafc; }}
  .container {{ max-width: 650px; margin: 40px auto; padding: 32px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  h1 {{ color: #1a365d; margin-bottom: 8px; }}
  h2 {{ color: #2d3748; font-size: 18px; margin-top: 24px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 12px 0; }}
  td {{ padding: 8px; border: 1px solid #e2e8f0; }}
  tr:nth-child(odd) {{ background: #f7fafc; }}
  td:first-child {{ font-weight: bold; width: 40%; }}
  .highlight {{ background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px; padding: 16px; margin: 12px 0; }}
  textarea {{ width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-family: Arial; font-size: 14px; resize: vertical; box-sizing: border-box; }}
  .btn {{ padding: 14px 32px; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; color: white; background: {actionColor}; }}
  .btn:hover {{ opacity: 0.9; }}
  .footer {{ margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }}
</style></head><body>
<div class='container'>
  <h1>{actionLabel} Beneficiary Request</h1>
  <p style='color: #718096;'>Project submitted with beneficiaries exceeding the set limit.</p>
  {errorHtml}
  <h2>Project Details</h2>
  <table>
    <tr><td>Project Title</td><td>{d.ProjectTitle}</td></tr>
    <tr><td>Description</td><td>{d.ProjectDescription ?? "—"}</td></tr>
    <tr><td>Project Date</td><td>{d.ProjectDate?.ToString("dd-MMM-yyyy") ?? "—"}</td></tr>
    <tr><td>Project Cost</td><td>{d.ProjectCost?.ToString("N2") ?? "—"}</td></tr>
    <tr><td>Man Hours</td><td>{d.ManHours?.ToString() ?? "—"}</td></tr>
    <tr><td>Rotarians Involved</td><td>{d.RotariansInvolved?.ToString() ?? "—"}</td></tr>
    <tr><td>Rotaractors Involved</td><td>{d.RotaractorsInvolved?.ToString() ?? "—"}</td></tr>
    <tr><td>RCC Involved</td><td>{d.RccInvolved?.ToString() ?? "—"}</td></tr>
  </table>

  <h2>Beneficiary Details</h2>
  <div class='highlight'>
    <p><strong>Set Limit:</strong> {d.CurrentLimit}</p>
    <p><strong>Requested Beneficiaries:</strong> <span style='color: #e53e3e; font-weight: bold;'>{d.RequestedBeneficiaries}</span></p>
  </div>

  {(d.PhotoUrls.Count > 0 ? $@"
  <h2>Project Photos</h2>
  <div style='margin: 12px 0; display: flex; flex-wrap: wrap; gap: 8px;'>
    {string.Join("", d.PhotoUrls.Select(url => $"<img src='{url}' alt='Project Photo' style='max-width: 200px; height: 150px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0;' />"))}
  </div>" : "")}

  <h2>Club & Admin Details</h2>
  <table>
    <tr><td>District</td><td>{d.DistrictNumber}</td></tr>
    <tr><td>Club</td><td>{d.ClubName}</td></tr>
    <tr><td>Admin Name</td><td>{d.RequestedByName}</td></tr>
    <tr><td>Admin Mobile</td><td>{d.RequestedByMobile}</td></tr>
    <tr><td>Admin Email</td><td>{d.RequestedByEmail}</td></tr>
  </table>

  <form method='POST' action='/api/beneficiary-approval/{token}/{action}' style='margin-top: 24px;'>
    <h2>Remark {remarkNote}</h2>
    <textarea name='remark' rows='3' placeholder='Enter your remark here...' {remarkRequired}></textarea>
    <div style='margin-top: 16px; text-align: center;'>
      <button type='submit' class='btn'>Confirm {actionLabel}</button>
    </div>
  </form>

  <div class='footer'>Thank you,<br/><strong>Team ROW</strong></div>
</div></body></html>";
    }
}
