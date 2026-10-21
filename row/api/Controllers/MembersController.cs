using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize] // RIZones left this anonymous: anyone could list members, swap push tokens and upload files
[Route("api/[controller]")]
public class MembersController : ControllerBase
{
    private readonly IMemberService _memberService;
    private readonly IAuditLogService _auditLog;
    private readonly string _connectionString;

    public MembersController(IMemberService memberService, IAuditLogService auditLog, IConfiguration configuration)
    {
        _memberService = memberService;
        _auditLog = auditLog;
        _connectionString = configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("DefaultConnection not configured");
    }

    // Lightweight projection used by the duplicate-check queries in Update —
    // when the caller (Club Admin) types a mobile/email that another active
    // member already holds, we surface that member's name + club in the 409 so
    // the CA knows where to contact for resolution.
    private class DupRow
    {
        public int Id { get; set; }
        public string? MemberName { get; set; }
        public string? ClubName { get; set; }
    }

    // Body for POST {id}/device-token. DeviceToken may be null/blank — the endpoint
    // treats that as "no change" and never wipes an existing stored token.
    public class DeviceTokenRequest
    {
        public string? DeviceToken { get; set; }
    }

    private int GetCurrentMemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    // Mobile app only: the Flutter client prepends the country code to the number ("+91 7700900123")
    // even though the code already travels as FkPrimary/SecondaryCountryId. Strip it using each
    // country's PhoneCode so the column keeps only the local number. Web saves are not touched.
    private async Task<(string? Primary, string? Secondary)> StripMobileCountryCodesAsync(
        string? primary, int primaryCountryId, string? secondary, int secondaryCountryId)
    {
        if (!UserPermissionHelper.IsMobileLogin(User)) return (primary, secondary);
        bool hasCode(string? v) => v != null && v.TrimStart().StartsWith('+');
        if (!hasCode(primary) && !hasCode(secondary)) return (primary, secondary);

        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var codes = (await Dapper.SqlMapper.QueryAsync<(int Id, string? PhoneCode)>(conn,
                "SELECT pk_country_id, PhoneCode FROM country_master WHERE pk_country_id IN @Ids",
                new { Ids = new[] { primaryCountryId, secondaryCountryId }.Distinct().ToArray() }))
            .ToDictionary(r => r.Id, r => r.PhoneCode);

        var primaryCode = codes.GetValueOrDefault(primaryCountryId);
        // Secondary country can be unset/unknown — fall back to the primary country's code.
        var secondaryCode = codes.GetValueOrDefault(secondaryCountryId) ?? primaryCode;
        return (PhoneNumberNormalizer.StripCountryCode(primary, primaryCode),
                PhoneNumberNormalizer.StripCountryCode(secondary, secondaryCode));
    }

    // Directory admins (SuperAdmin / Club Admin / District Admin) are exempt from the
    // contact-visibility flags: they edit PrimaryMobileNumber and EmailId through this
    // very payload, so hiding them would blank the edit form and wipe the record on save.
    private bool BypassesContactPrivacy() =>
        UserPermissionHelper.CanCrudDirectoryMember(User) || UserPermissionHelper.CanPartialEditDirectoryMember(User);

    // Applies the four visibility flags to already-projected DTOs. This controller has no
    // [Authorize], so an anonymous caller resolves to viewerMemberId = null → no shared
    // club, no self-bypass, AllClubs flags decide. Filtering lives here rather than in
    // MemberService because Update/Delete read the same DTO and need the real values.
    private async Task ApplyContactPrivacyAsync(IReadOnlyCollection<(int Id, Action HidePhone, Action HideEmail)> targets)
    {
        if (targets.Count == 0 || BypassesContactPrivacy()) return;

        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var viewerMemberId = MemberPrivacyHelper.GetViewerMemberId(User);
        var clubPeerMemberIds = await MemberPrivacyHelper.GetClubPeerMemberIdsAsync(conn, viewerMemberId);
        var flagMap = await MemberPrivacyHelper.GetFlagsAsync(conn, targets.Select(t => t.Id));

        foreach (var (rowMemberId, hidePhone, hideEmail) in targets)
        {
            var flags = MemberPrivacyHelper.FlagsFor(flagMap, rowMemberId);
            bool sharesClub = clubPeerMemberIds.Contains(rowMemberId);
            if (!MemberPrivacyHelper.ShouldShowPhone(viewerMemberId, rowMemberId, sharesClub, flags)) hidePhone();
            if (!MemberPrivacyHelper.ShouldShowEmail(viewerMemberId, rowMemberId, sharesClub, flags)) hideEmail();
        }
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<MemberListDto>>> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string? search = null,
        [FromQuery] string? bloodGroup = null,
        [FromQuery] string? gender = null)
    {
        var result = await _memberService.GetAllAsync(page, pageSize, search, bloodGroup, gender);
        await ApplyContactPrivacyAsync(result.Items
            .Select(m => (m.Id, (Action)(() => m.PrimaryMobileNumber = null), (Action)(() => m.EmailId = null)))
            .ToList());
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<MemberDetailDto>> GetById(int id, [FromQuery] int? clubId = null)
    {
        var member = await _memberService.GetByIdAsync(id, clubId);
        if (member == null)
            return NotFound(new { message = "Member not found" });
        await ApplyContactPrivacyAsync(new[]
        {
            (member.Id, (Action)(() => member.PrimaryMobileNumber = null), (Action)(() => member.EmailId = null))
        });
        return Ok(member);
    }

    // ── Device token (FCM push) ────────────────────────────────────────────
    // GET returns the token currently stored for the member (null if none).
    [HttpGet("{id}/device-token")]
    public async Task<ActionResult> GetDeviceToken(int id)
    {
        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var exists = await Dapper.SqlMapper.ExecuteScalarAsync<int>(conn,
            "SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND IFNULL(isdeleted, 0) = 0",
            new { Id = id });
        if (exists == 0) return NotFound(new { message = "Member not found" });

        var token = await Dapper.SqlMapper.ExecuteScalarAsync<string?>(conn,
            "SELECT LastDeviceToken FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
            new { Id = id });
        return Ok(new { memberId = id, deviceToken = token });
    }

    // POST registers/updates the member's device token.
    // GUARD (per requirement): if the incoming token is null/blank AND the DB already
    // holds a value, DO NOT overwrite it. COALESCE(NULLIF(TRIM(@Token),''), LastDeviceToken)
    // keeps the existing token whenever the request supplies nothing usable — so a
    // tokenless call can never wipe a live device.
    [HttpPost("{id}/device-token")]
    public async Task<ActionResult> SetDeviceToken(int id, [FromBody] DeviceTokenRequest? request)
    {
        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var exists = await Dapper.SqlMapper.ExecuteScalarAsync<int>(conn,
            "SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND IFNULL(isdeleted, 0) = 0",
            new { Id = id });
        if (exists == 0) return NotFound(new { message = "Member not found" });

        await Dapper.SqlMapper.ExecuteAsync(conn,
            @"UPDATE member_master_profile
              SET LastDeviceToken = COALESCE(NULLIF(TRIM(@Token), ''), LastDeviceToken)
              WHERE pk_member_master_profile_id = @Id",
            new { Id = id, Token = request?.DeviceToken });

        var stored = await Dapper.SqlMapper.ExecuteScalarAsync<string?>(conn,
            "SELECT LastDeviceToken FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
            new { Id = id });
        return Ok(new { memberId = id, deviceToken = stored });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateMemberDto dto)
    {
        // Directory module: only SuperAdmin can add members
        if (!UserPermissionHelper.CanCrudDirectoryMember(User))
            return StatusCode(403, new { message = "Only SuperAdmin can add members to the directory." });

        (dto.PrimaryMobileNumber, dto.SecondaryMobileNumber) = await StripMobileCountryCodesAsync(
            dto.PrimaryMobileNumber, dto.FkPrimaryCountryId, dto.SecondaryMobileNumber, dto.FkSecondaryCountryId);

        try
        {
            var id = await _memberService.CreateAsync(dto);
            await _auditLog.LogAsync(GetCurrentMemberId(), "CREATE", "member", id, dto.MemberName, dto, HttpContext);
            return CreatedAtAction(nameof(GetById), new { id }, new { id });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateMemberDto dto)
    {
        // Three-tier write policy for directory members:
        //   SuperAdmin  → edit anything
        //   Self        → edit own profile fully
        //   Admin (CA / DA) → edit MOST fields, but the 10 fields listed in
        //                     UserPermissionHelper.DirectoryMemberLockedFields are
        //                     read-only — we silently revert any attempt to change
        //                     them so a malicious payload from a tampered client
        //                     can't bypass the UI lock.
        //   Other roles → 403
        var currentMemberId = int.TryParse(User.FindFirst("memberId")?.Value, out var cmid) ? cmid : 0;
        bool isSelf = id == currentMemberId;
        bool isSA = UserPermissionHelper.CanCrudDirectoryMember(User);
        bool isAdminPartial = UserPermissionHelper.CanPartialEditDirectoryMember(User);

        if (!isSA && !isSelf && !isAdminPartial)
            return StatusCode(403, new { message = "You do not have permission to edit directory members." });

        var existing = await _memberService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "Member not found" });

        // A club / district admin may edit only members of a club they manage (was: any member anywhere).
        if (isAdminPartial && !isSA && !isSelf)
        {
            await using var scopeConn = new MySqlConnector.MySqlConnection(_connectionString);
            var clubIds = await Dapper.SqlMapper.QueryAsync<int>(scopeConn,
                "SELECT fk_club_id FROM club_members WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND isdeleted = 0",
                new { Id = id });
            var manages = false;
            foreach (var clubId in clubIds)
                if (await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, currentMemberId, true, clubId)) { manages = true; break; }
            if (!manages)
                return StatusCode(403, new { message = "You can only edit members of a club you manage." });
        }

        // Before the duplicate check + change detection below, so "+91 7700…" is compared as "7700…".
        (dto.PrimaryMobileNumber, dto.SecondaryMobileNumber) = await StripMobileCountryCodesAsync(
            dto.PrimaryMobileNumber, dto.FkPrimaryCountryId, dto.SecondaryMobileNumber, dto.FkSecondaryCountryId);

        // Admin (CA/DA) editing someone else's record → strip locked fields. SA and
        // self-edit see no restriction. Keys are typed via nameof() in the helper so
        // this stays in sync if a DTO property is renamed.
        if (isAdminPartial && !isSA && !isSelf)
        {
            var locked = UserPermissionHelper.DirectoryMemberLockedFields;
            if (locked.Contains(nameof(UpdateMemberDto.PrimaryMobileNumber)))   dto.PrimaryMobileNumber   = existing.PrimaryMobileNumber;
            if (locked.Contains(nameof(UpdateMemberDto.SecondaryMobileNumber))) dto.SecondaryMobileNumber = existing.SecondaryMobileNumber;
            if (locked.Contains(nameof(UpdateMemberDto.RotaryId)))              dto.RotaryId              = existing.RotaryId;
            // IsHonoraryMember removed from UpdateMemberDto 2026-06-26 — moved to club_members per-club.
            if (locked.Contains(nameof(UpdateMemberDto.IsYouth)))               dto.IsYouth               = existing.IsYouth;
            if (locked.Contains(nameof(UpdateMemberDto.JoinedDate)))            dto.JoinedDate            = existing.JoinedDate;
            if (locked.Contains(nameof(UpdateMemberDto.IsPersonalDetailsVisible))) dto.IsPersonalDetailsVisible = existing.IsPersonalDetailsVisible;
            if (locked.Contains(nameof(UpdateMemberDto.FkPrimaryCountryId)))    dto.FkPrimaryCountryId    = existing.FkPrimaryCountryId;
            if (locked.Contains(nameof(UpdateMemberDto.FkSecondaryCountryId)))  dto.FkSecondaryCountryId  = existing.FkSecondaryCountryId;
            if (locked.Contains(nameof(UpdateMemberDto.EmailId)))               dto.EmailId               = existing.EmailId;
            if (locked.Contains(nameof(UpdateMemberDto.IsFamilyDetailsVisible))) dto.IsFamilyDetailsVisible = existing.IsFamilyDetailsVisible;
            if (locked.Contains(nameof(UpdateMemberDto.PrimaryLanguage)) && !string.IsNullOrEmpty(existing.PrimaryLanguage))
                dto.PrimaryLanguage = existing.PrimaryLanguage;
        }

        // Duplicate-check on the 3 newly-unlocked-for-Admin fields. Run for every
        // role (not just Admin) — even SA shouldn't accidentally overlap members.
        // Skip self (the member's own values).
        await using (var dupConn = new MySqlConnector.MySqlConnection(_connectionString))
        {
            await dupConn.OpenAsync();
            // PrimaryMobileNumber duplicate check (when changed)
            if (!string.IsNullOrWhiteSpace(dto.PrimaryMobileNumber) &&
                !string.Equals(dto.PrimaryMobileNumber, existing.PrimaryMobileNumber, StringComparison.Ordinal))
            {
                // INNER JOIN club_members: only a member with an ACTIVE club membership counts as a
                // conflict. Terminated members keep their profile + mobile (never deleted, for Family
                // Login / re-sync) but must NOT block edits — otherwise a person Rotary.org terminated
                // and re-added under a NEW RotaryId (same mobile) leaves an orphan twin that blocks the
                // active member's mobile forever. Real active-vs-active clashes are still caught.
                var other = await Dapper.SqlMapper.QueryFirstOrDefaultAsync<DupRow>(dupConn,
                    @"SELECT m.pk_member_master_profile_id AS Id, m.MemberName, c.ClubName
                      FROM member_master_profile m
                      INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                                                AND cm.IsActive = 1 AND cm.isdeleted = 0
                      LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                      WHERE m.PrimaryMobileNumber = @Mobile AND m.isdeleted = 0
                        AND m.pk_member_master_profile_id <> @SelfId
                      LIMIT 1",
                    new { Mobile = dto.PrimaryMobileNumber, SelfId = id });
                if (other != null)
                {
                    return Conflict(new
                    {
                        message = $"This mobile number is already used by {other.MemberName}"
                                  + (string.IsNullOrEmpty(other.ClubName) ? "" : $" in {other.ClubName}")
                                  + ". Please use a different mobile number."
                    });
                }
            }
            // EmailId duplicate check (when changed) — case-insensitive
            if (!string.IsNullOrWhiteSpace(dto.EmailId) &&
                !string.Equals(dto.EmailId, existing.EmailId, StringComparison.OrdinalIgnoreCase))
            {
                // INNER JOIN club_members: same rule as the mobile check — only an ACTIVE member
                // (with a live club membership) blocks the email. A terminated twin under an old
                // RotaryId keeps its email but must not block the active member's edit.
                var other = await Dapper.SqlMapper.QueryFirstOrDefaultAsync<DupRow>(dupConn,
                    @"SELECT m.pk_member_master_profile_id AS Id, m.MemberName, c.ClubName
                      FROM member_master_profile m
                      INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                                                AND cm.IsActive = 1 AND cm.isdeleted = 0
                      LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                      WHERE m.EmailId = @Email AND m.isdeleted = 0
                        AND m.pk_member_master_profile_id <> @SelfId
                      LIMIT 1",
                    new { Email = dto.EmailId, SelfId = id });
                if (other != null)
                {
                    return Conflict(new
                    {
                        message = $"This email is already used by {other.MemberName}"
                                  + (string.IsNullOrEmpty(other.ClubName) ? "" : $" in {other.ClubName}")
                                  + ". Please use a different email."
                    });
                }
            }

            // Mobile changed → force the affected member to re-log in on mobile.
            // The check itself happens in MobileJwtRefreshMiddleware which compares
            // mobile_force_relogin_at against the JWT's iat claim. Setting the column
            // to UTC_TIMESTAMP() here invalidates every JWT issued before this moment.
            if (!string.IsNullOrWhiteSpace(dto.PrimaryMobileNumber) &&
                !string.Equals(dto.PrimaryMobileNumber, existing.PrimaryMobileNumber, StringComparison.Ordinal))
            {
                await Dapper.SqlMapper.ExecuteAsync(dupConn,
                    "UPDATE member_master_profile SET mobile_force_relogin_at = UTC_TIMESTAMP() WHERE pk_member_master_profile_id = @Id",
                    new { Id = id });
            }
        }

        // Mobile self-edit: keep core identity fields read-only. A Member updating
        // their own profile from the mobile app cannot rewrite mobile / Rotary ID /
        // email / honorary flag — changes there would silently break login + billing.
        // Web self-edit (SA editing own profile from the portal) is NOT gated.
        if (isSelf && UserPermissionHelper.IsMobileLogin(User))
        {
            var mLocked = UserPermissionHelper.MobileSelfEditLockedFields;
            if (mLocked.Contains(nameof(UpdateMemberDto.PrimaryMobileNumber))) dto.PrimaryMobileNumber = existing.PrimaryMobileNumber;
            if (mLocked.Contains(nameof(UpdateMemberDto.RotaryId)))            dto.RotaryId            = existing.RotaryId;
            if (mLocked.Contains(nameof(UpdateMemberDto.EmailId)))             dto.EmailId             = existing.EmailId;
            // IsHonoraryMember moved to club_members per-club 2026-06-26 — no longer on UpdateMemberDto.
        }

        try
        {
            await _memberService.UpdateAsync(id, dto);
            await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "member", id, dto.MemberName, dto, HttpContext);
            return NoContent();
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        // Directory module: only SuperAdmin can delete members
        if (!UserPermissionHelper.CanCrudDirectoryMember(User))
            return StatusCode(403, new { message = "Only SuperAdmin can delete directory members." });

        var existing = await _memberService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "Member not found" });

        await _memberService.DeleteAsync(id);
        await _auditLog.LogAsync(GetCurrentMemberId(), "DELETE", "member", id, existing.MemberName, null, HttpContext);
        return NoContent();
    }

    [HttpPost("upload")]
    public async Task<ActionResult<object>> Upload(IFormFile file, [FromQuery] string type = "profile")
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedTypes = new[] { "profile", "family", "familymember" };
        if (!allowedTypes.Contains(type.ToLower()))
            return BadRequest(new { message = "Invalid upload type. Use: profile, family, or familymember" });

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });

        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        var path = await _memberService.UploadPhotoAsync(file, type.ToLower());
        return Ok(new { path });
    }
}
