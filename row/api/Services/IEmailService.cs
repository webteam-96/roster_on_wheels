namespace RotaryApi.Services;

public interface IEmailService
{
    Task SendCredentialEmailAsync(string email, string memberName, string tempPassword);
    Task SendZonalCoordinatorEmailAsync(string email, string memberName, string mobileNumber, string tempPassword, string zoneName);
    Task SendPasswordResetEmailAsync(string email, string memberName, string resetLink);
    Task SendPasswordChangedEmailAsync(string email, string memberName);
    Task SendBeneficiaryApprovalEmailAsync(string coordinatorEmail, string coordinatorName, DTOs.BeneficiaryApprovalDetailDto detail, string? approveUrl, string? rejectUrl);
    Task SendBeneficiaryDecisionEmailAsync(string adminEmail, string adminName, DTOs.BeneficiaryApprovalDetailDto detail, string decision, string? remark);
    Task SendEmailWithAttachmentAsync(string toEmail, string subject, string htmlBody, byte[] attachment, string attachmentFileName);
    Task SendEmailWithAttachmentAsync(string toEmail, string subject, string htmlBody, byte[] attachment, string attachmentFileName, IEnumerable<string>? ccEmails);
    // Same as above, but stamps email_log.fk_district_id / fk_club_id and an explicit email_type, so a
    // scoped report (District Performance Report) shows in that district's email log. Throws on failure.
    Task SendScopedEmailWithAttachmentAsync(string toEmail, string subject, string htmlBody, byte[] attachment, string attachmentFileName,
        IEnumerable<string>? ccEmails, int? clubId, int? districtId, string emailType);
    Task SendGenericEmailAsync(string toEmail, string subject, string htmlBody);

    // Club/District-tagged send (stamps email_log.fk_club_id/fk_district_id) for the scheduled
    // communication emails, so Club/District admins can see their own scoped email log.
    Task SendScopedEmailAsync(string toEmail, string subject, string htmlBody, int? clubId, int? districtId);
    // TO + optional CC on the same Brevo message. Pass null/blank CC when
    // there's no CC. Used by membership-dues receipt to keep the CC recipients
    // ON the same email as the member (instead of N separate TO messages).
    Task SendGenericEmailWithCcAsync(string toEmail, string? ccEmail, string subject, string htmlBody);
    // Mass-email send: overrides sender NAME with the admin-supplied "From
    // Name" and adds an optional Reply-To. Sender EMAIL is read from
    // Brevo:MassEmailSenderEmail (falls back to Brevo:SenderEmail). Kept
    // separate from SendGenericEmailAsync so other flows (OTP, receipts,
    // reminders) keep using the default no-reply sender.
    Task SendMassEmailAsync(string toEmail, string subject, string htmlBody, string? fromName, string? replyName, string? replyEmail);
    Task SendSuperAdminWelcomeEmailAsync(string email, string memberName, string mobileNumber, string? tempPassword);
    Task SendSuperAdminRevokedEmailAsync(string email, string memberName);
    Task SendNewMemberWelcomeEmailAsync(string memberEmail, string memberName, string clubName, string? districtNumber, string? zoneName, IEnumerable<string>? ccEmails);
    Task SendRoleOrMembershipRemovedEmailAsync(string toEmail, string memberName, string removedFromLabel, string? contextLine, IEnumerable<string>? ccEmails);
    Task<string?> SendClubAdminAssignmentEmailAsync(string email, string memberName, string? mobile, string? tempPassword, string designation, string clubName, string yearLabel);
    Task SendClubWebsiteReminderEmailAsync(string email, string memberName, string clubName, string designation, string subdomain, DateTime endDate, int daysLeft, string? payLink = null);
    // SuperAdmin bulk buy/renew reminder carrying a one-click encrypted pay link. orderType = "New" | "Renewal".
    Task SendClubWebsitePayLinkEmailAsync(string email, string memberName, string clubName, string designation, string orderType, decimal totalAmount, DateTime? endDate, int? daysLeft, string payLink);
    Task SendClubWebsiteActivationEmailAsync(string email, string memberName, string clubName, string designation, string subdomain, string? clientDomain, DateTime startDate, DateTime endDate, string? ccEmail = null);
}
