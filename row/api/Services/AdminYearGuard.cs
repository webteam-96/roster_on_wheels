using System.Security.Claims;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// The ONE call every add / edit / delete makes to enforce Year-wise Admin Rights.
///
/// Controllers do:
/// <code>
///     var denied = await _guard.ClubYearAsync(User, clubId, dto.YearId);
///     if (denied != null) return denied;
/// </code>
///
/// Why a guard rather than a check in each controller: hidden buttons are not
/// security, and copy-pasted checks drift. The club boundary on
/// <c>admin/assign-role</c> ended up living in two front-end screens precisely
/// because there was no single place like this.
///
/// ⚠️ Decide from the year STORED ON THE RECORD, never the year the client sends.
/// On an EDIT, check BOTH — see <see cref="ClubYearMoveAsync"/> — or a record
/// could be dragged into or out of someone's year.
/// </summary>
/// <summary>What kind of id a Membership Dues endpoint was given.</summary>
public enum MembershipDuesIdKind { Setup, MemberFee, Payment }

public class AdminYearGuard
{
    private readonly IAdminYearService _years;
    private readonly IConfiguration _config;
    private readonly IHttpContextAccessor? _http;

    public AdminYearGuard(IAdminYearService years, IConfiguration config, IHttpContextAccessor? http = null)
    {
        _years = years;
        _config = config;
        _http = http;
    }

    /// <summary>A cross-district write grant the scope guard accepted for THIS request (allow-listed path, live
    /// grant, this member, this district) covers the years that overlap its window. Nothing else reaches here.</summary>
    private async Task<bool> WriteGrantCoversAsync(MySqlConnection conn, int memberId, int districtId, int yearId)
    {
        if (_http?.HttpContext?.Items[CrossDistrictAccess.WriteItemKey] is not DistrictAccessGrant g
            || g.MemberId != memberId || g.DistrictId != districtId || !g.CanWrite) return false;
        var y = await conn.QueryFirstOrDefaultAsync<(DateTime Start, DateTime End)>(
            "SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Id", new { Id = yearId });
        return y.Start != default && CrossDistrictAccess.CoversYear(g, y.Start, y.End);
    }

    private static int MemberId(ClaimsPrincipal user) =>
        int.TryParse(user.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<MySqlConnection> OpenAsync()
    {
        var conn = RowDb.Connect(_config.GetConnectionString("DefaultConnection"));
        await conn.OpenAsync();
        return conn;
    }

    private static ObjectResult Denied(string message) =>
        new(new { message }) { StatusCode = 403 };

    /// <summary>
    /// May this caller change something belonging to <paramref name="clubId"/> in
    /// <paramref name="yearId"/>? Returns null when allowed, or the 403 to return.
    /// </summary>
    public async Task<ObjectResult?> ClubYearAsync(ClaimsPrincipal user, int clubId, int yearId)
        => await ClubYearAsync(user, clubId, yearId, yearless: false);

    /// <param name="yearless">
    /// True when the caller reached here from <see cref="ClubYearlessAsync"/> —
    /// the data has no year of its own and we substituted the current one. The
    /// check is the same; only the wording changes, because telling someone
    /// editing a weblink that they "can only edit 2025-26" is baffling when the
    /// screen never mentioned a year.
    /// </param>
    private async Task<ObjectResult?> ClubYearAsync(ClaimsPrincipal user, int clubId, int yearId, bool yearless)
    {
        var memberId = MemberId(user);
        if (memberId <= 0) return Denied("Not signed in.");
        if (clubId <= 0) return Denied("No club specified.");

        await using var conn = await OpenAsync();
        var rights = await _years.GetClubRightsAsync(conn, memberId, clubId);

        // No rights at all in this club — a scope failure, not a year one. Say so
        // plainly; "wrong year" would be misleading and send people hunting.
        if (!rights.Any)
            return Denied("You are not an admin of this club.");

        if (yearId <= 0) return Denied("No Rotary year specified.");
        if (rights.Covers(yearId)) return null;

        var label = await YearLabelAsync(conn, yearId);
        var mine = await YearLabelsAsync(conn, rights.YearIds);
        var held = mine.Count == 0 ? "no Rotary years" : string.Join(", ", mine);
        return Denied(yearless
            ? $"This page is not year-wise, so changing it needs admin rights for the current Rotary year ({label}). You are an admin for {held}."
            : $"You can only edit {held} for this club, not {label}.");
    }

    /// <summary>
    /// An EDIT that may move a record between years. Both the year it is in NOW
    /// and the year it is going TO must be yours — otherwise a single-year admin
    /// could drag someone else's record into their year, or push their own out of
    /// reach.
    /// </summary>
    public async Task<ObjectResult?> ClubYearMoveAsync(
        ClaimsPrincipal user, int clubId, int currentYearId, int newYearId)
    {
        var denied = await ClubYearAsync(user, clubId, currentYearId);
        if (denied != null) return denied;
        if (newYearId == currentYearId) return null;
        return await ClubYearAsync(user, clubId, newYearId);
    }

    /// <summary>
    /// Some records carry no year field — the year is implied by a DATE (projects
    /// are filed into a year-partitioned table by their project date). Resolve the
    /// year the same way the write path will, then check it.
    ///
    /// ⚠️ Resolving it here rather than trusting a client-supplied year is the
    /// point: the date decides where the row lands, so the date is what must be
    /// authorised.
    /// </summary>
    public async Task<ObjectResult?> ClubYearForDateAsync(ClaimsPrincipal user, int clubId, DateTime? date)
    {
        if (date == null) return Denied("No date supplied, so the Rotary year cannot be determined.");
        await using var conn = await OpenAsync();
        // Look the year up WITHOUT creating one — a denied caller must not leave a
        // new rotary year behind as a side effect.
        var yearId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_year_id FROM rotary_year_master
            WHERE COALESCE(isdeleted,0) = 0 AND @D >= StartDate AND @D <= EndDate
            LIMIT 1", new { D = date.Value.Date });
        // No year row yet (a genuinely new year). Only someone with All Years could
        // legitimately be opening one, so require that rather than guessing.
        if (yearId is not int y)
        {
            var rights = await _years.GetClubRightsAsync(conn, MemberId(user), clubId);
            return rights.AllYears ? null : Denied("That date falls in a Rotary year you cannot edit.");
        }
        return await ClubYearAsync(user, clubId, y);
    }

    /// <summary>The district twin of <see cref="ClubYearForDateAsync"/>.</summary>
    public async Task<ObjectResult?> DistrictYearForDateAsync(ClaimsPrincipal user, int districtId, DateTime? date)
    {
        if (date == null) return Denied("No date supplied, so the Rotary year cannot be determined.");
        await using var conn = await OpenAsync();
        var yearId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_year_id FROM rotary_year_master
            WHERE COALESCE(isdeleted,0) = 0 AND @D >= StartDate AND @D <= EndDate
            LIMIT 1", new { D = date.Value.Date });
        if (yearId is not int y)
        {
            var rights = await _years.GetDistrictRightsAsync(conn, MemberId(user), districtId);
            return rights.AllYears ? null : Denied("That date falls in a Rotary year you cannot edit.");
        }
        // ⚠️ yearless: false — the record IS year-wise, its DATE just carries the
        // year instead of a column. The year-less wording would tell the reader
        // to get current-year rights, when what they need is rights for the year
        // the date falls in.
        return await DistrictYearAsync(user, districtId, y, yearless: false);
    }

    /// <summary>The district twin of <see cref="ClubYearMoveAsync"/>.</summary>
    public async Task<ObjectResult?> DistrictYearMoveAsync(
        ClaimsPrincipal user, int districtId, int currentYearId, DateTime? newDate)
    {
        var denied = await DistrictYearAsync(user, districtId, currentYearId);
        if (denied != null) return denied;
        return await DistrictYearForDateAsync(user, districtId, newDate);
    }

    /// <summary>The district twin of <see cref="ClubYearAsync"/>.</summary>
    public async Task<ObjectResult?> DistrictYearAsync(ClaimsPrincipal user, int districtId, int yearId)
        => await DistrictYearAsync(user, districtId, yearId, yearless: false);

    private async Task<ObjectResult?> DistrictYearAsync(ClaimsPrincipal user, int districtId, int yearId, bool yearless)
    {
        var memberId = MemberId(user);
        if (memberId <= 0) return Denied("Not signed in.");
        if (districtId <= 0) return Denied("No district specified.");

        await using var conn = await OpenAsync();
        var rights = await _years.GetDistrictRightsAsync(conn, memberId, districtId);
        if (yearId > 0 && !rights.Covers(yearId) && await WriteGrantCoversAsync(conn, memberId, districtId, yearId)) return null;
        if (!rights.Any) return Denied("You are not an admin of this district.");
        if (yearId <= 0) return Denied("No Rotary year specified.");
        if (rights.Covers(yearId)) return null;

        var label = await YearLabelAsync(conn, yearId);
        var mine = await YearLabelsAsync(conn, rights.YearIds);
        var held = mine.Count == 0 ? "no Rotary years" : string.Join(", ", mine);
        return Denied(yearless
            ? $"This page is not year-wise, so changing it needs admin rights for the current Rotary year ({label}). You are an admin for {held}."
            : $"You can only edit {held} for this district, not {label}.");
    }

    /// <summary>
    /// For the 116 tables that carry NO Rotary year. Confirmed rule: editing
    /// those needs CURRENT-year rights.
    /// </summary>
    /// <summary>
    /// Guard an edit that identifies its record by PRIMARY KEY, not by year —
    /// "save report 4821", "delete document 913". The record's own year decides,
    /// so we read it first.
    ///
    /// ⚠️ Pass only literal table/column names from calling code. They are
    /// interpolated into SQL because MySQL cannot parameterise identifiers;
    /// never route user input here.
    /// </summary>
    /// <returns>
    /// The 403 to return, or null when allowed. A record that does not exist
    /// (or is soft-deleted) is ALLOWED through — letting the endpoint answer
    /// 404 itself, rather than telling a stranger "wrong year" about a row we
    /// have just confirmed exists.
    /// </returns>
    public async Task<ObjectResult?> ClubRecordYearAsync(
        ClaimsPrincipal user, int clubId, string table, string pkColumn, int recordId)
    {
        if (recordId <= 0) return await ClubYearlessAsync(user, clubId);

        await using var conn = await OpenAsync();
        var yearId = await conn.ExecuteScalarAsync<int?>(
            $"SELECT fk_year_id FROM `{table}` WHERE `{pkColumn}` = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = recordId });

        if (yearId is null) return null;                       // let the endpoint 404
        return await ClubYearAsync(user, clubId, yearId.Value);
    }

    /// <summary>
    /// An edit where the record's year is derived from a DATE, and changing that
    /// date MOVES the record between years — a newsletter re-dated from June to
    /// July leaves 2025-26 and lands in 2026-27.
    ///
    /// Both ends are checked: the year it is in now, and the year the new date
    /// puts it in. Checking only one would let a single-year admin push a record
    /// out of their own reach, or pull someone else's into it.
    /// </summary>
    public async Task<ObjectResult?> ClubRecordMoveByDateAsync(
        ClaimsPrincipal user, int clubId, string table, string pkColumn, int recordId, DateTime? newDate)
    {
        await using var conn = await OpenAsync();
        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            $"SELECT fk_year_id FROM `{table}` WHERE `{pkColumn}` = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = recordId });

        // No such record — let the endpoint answer 404 rather than leaking that
        // it exists by talking about years.
        if (currentYearId is not int current) return null;

        var denied = await ClubYearAsync(user, clubId, current);
        if (denied != null) return denied;

        // Where the new date sends it. An unparseable or out-of-range date leaves
        // the record where it is, so there is no second year to check.
        return await ClubYearForDateAsync(user, clubId, newDate);
    }

    /// <summary>
    /// Club Dues stores its Rotary year as a LABEL ("2026-27") in
    /// club_dues.RotaryYear, not as an fk_year_id like everything else. Resolve
    /// the label, then apply the normal district year rule.
    /// </summary>
    public async Task<ObjectResult?> DistrictYearByLabelAsync(
        ClaimsPrincipal user, int districtId, string? yearLabel)
    {
        if (string.IsNullOrWhiteSpace(yearLabel))
            return Denied("No Rotary year supplied.");

        await using var conn = await OpenAsync();
        var yearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE YearLabel = @L AND COALESCE(isdeleted,0) = 0",
            new { L = yearLabel.Trim() });

        if (yearId is not int y) return Denied($"Unknown Rotary year \"{yearLabel}\".");
        return await DistrictYearAsync(user, districtId, y);
    }

    /// <summary>
    /// Every write against a dues campaign — editing it, setting one club's rate,
    /// chasing a club for payment — is a DISTRICT admin action on that campaign's
    /// year. Both come off the campaign row.
    ///
    /// ⚠️ Not a club guard. The caller is a District Admin of the campaign's
    /// district and need not be an admin of the club being charged; guarding on
    /// the club would lock out the very people the endpoints are for.
    /// </summary>
    public async Task<ObjectResult?> DuesCampaignYearAsync(ClaimsPrincipal user, int duesId)
    {
        await using var conn = await OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<(int DistrictId, string? RotaryYear)>(
            "SELECT fk_district_id AS DistrictId, RotaryYear FROM club_dues " +
            "WHERE pk_club_dues_id = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = duesId });

        // No such campaign — let the endpoint answer 404 itself.
        if (row.DistrictId == 0 && row.RotaryYear == null) return null;
        return await DistrictYearByLabelAsync(user, row.DistrictId, row.RotaryYear);
    }

    /// <summary>
    /// A dues action identified by PAYMENT id — approving, rejecting, re-issuing
    /// a receipt. The payment belongs to a campaign, and the campaign carries the
    /// district and the year.
    /// </summary>
    public async Task<ObjectResult?> DuesPaymentYearAsync(ClaimsPrincipal user, int paymentId)
    {
        await using var conn = await OpenAsync();
        var duesId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_club_dues_id FROM club_dues_payments " +
            "WHERE pk_club_dues_payment_id = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = paymentId });

        // Unknown payment — let the endpoint 404 rather than talk about years.
        if (duesId is not int d) return null;
        return await DuesCampaignYearAsync(user, d);
    }

    /// <summary>
    /// Membership Dues — a club charging its own members. Like Club Dues it
    /// stores the year as a LABEL, but the scope is the CLUB that raised it.
    /// </summary>
    public async Task<ObjectResult?> ClubYearByLabelAsync(
        ClaimsPrincipal user, int clubId, string? yearLabel)
    {
        if (string.IsNullOrWhiteSpace(yearLabel))
            return Denied("No Rotary year supplied.");

        await using var conn = await OpenAsync();
        var yearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE YearLabel = @L AND COALESCE(isdeleted,0) = 0",
            new { L = yearLabel.Trim() });

        if (yearId is not int y) return Denied($"Unknown Rotary year \"{yearLabel}\".");
        return await ClubYearAsync(user, clubId, y);
    }

    /// <summary>
    /// Every write against a membership-dues setup — editing it, allocating fees,
    /// recording or approving a member's payment, chasing a member — belongs to
    /// the setup's club and Rotary year. Both come off the setup row.
    ///
    /// <paramref name="idKind"/> says what the caller has: the setup itself, one
    /// member-fee row, or one payment. Each resolves back to the same setup.
    /// </summary>
    public async Task<ObjectResult?> MembershipDuesYearAsync(
        ClaimsPrincipal user, int id, MembershipDuesIdKind idKind = MembershipDuesIdKind.Setup)
    {
        await using var conn = await OpenAsync();

        var duesId = idKind switch
        {
            MembershipDuesIdKind.MemberFee => await conn.ExecuteScalarAsync<int?>(
                "SELECT fk_membership_dues_id FROM membership_dues_member_fees WHERE pk_id = @Id", new { Id = id }),
            MembershipDuesIdKind.Payment => await conn.ExecuteScalarAsync<int?>(
                "SELECT fk_membership_dues_id FROM membership_dues_payments WHERE pk_id = @Id", new { Id = id }),
            _ => id,
        };

        // Unknown row — let the endpoint answer 404 rather than discuss years.
        if (duesId is not int d || d <= 0) return null;

        var setup = await conn.QueryFirstOrDefaultAsync<(int ClubId, string? RotaryYear)>(
            "SELECT fk_club_id AS ClubId, RotaryYear FROM membership_dues " +
            "WHERE pk_membership_dues_id = @Id AND COALESCE(isdeleted,0) = 0", new { Id = d });

        if (setup.ClubId == 0 && setup.RotaryYear == null) return null;
        return await ClubYearByLabelAsync(user, setup.ClubId, setup.RotaryYear);
    }

    /// <summary>
    /// Event Payment Links carry NO Rotary year — a link is live now and takes
    /// money now — so editing one follows the year-less rule: CURRENT-year rights
    /// on whichever club or district owns the link.
    ///
    /// <paramref name="byMemberPayment"/> true means the id is an
    /// event_payment_members row rather than the link itself.
    /// </summary>
    public async Task<ObjectResult?> EventPaymentLinkAsync(
        ClaimsPrincipal user, int id, bool byMemberPayment = false)
    {
        await using var conn = await OpenAsync();

        var linkId = byMemberPayment
            ? await conn.ExecuteScalarAsync<int?>(
                "SELECT fk_payment_link_id FROM event_payment_members WHERE pk_id = @Id", new { Id = id })
            : id;

        // Unknown row — let the endpoint answer 404 rather than discuss years.
        if (linkId is not int lid || lid <= 0) return null;

        var owner = await conn.QueryFirstOrDefaultAsync<(int? ClubId, int? DistrictId)>(
            "SELECT fk_club_id AS ClubId, fk_district_master_id AS DistrictId " +
            "FROM event_payment_links WHERE pk_id = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = lid });

        if (owner.ClubId is int c && c > 0) return await ClubYearlessAsync(user, c);
        if (owner.DistrictId is int d && d > 0) return await DistrictYearlessAsync(user, d);
        return null;   // no owner recorded — leave it to the endpoint's own checks
    }

    /// <summary>
    /// A record whose Rotary year is implied by a DATE COLUMN rather than an
    /// fk_year_id — a PPH camp belongs to the year its CampDate falls in, and
    /// pph_camps has no year column at all.
    ///
    /// When <paramref name="newDate"/> is supplied the record may be MOVING
    /// between years, so both ends are checked, the same as a newsletter re-date.
    ///
    /// ⚠️ Literal table/column names only — they are interpolated, because MySQL
    /// cannot parameterise identifiers.
    /// </summary>
    public async Task<ObjectResult?> ClubRecordDateYearAsync(
        ClaimsPrincipal user, int clubId, string table, string pkColumn, int recordId,
        string dateColumn, DateTime? newDate = null)
    {
        await using var conn = await OpenAsync();
        var current = await conn.ExecuteScalarAsync<DateTime?>(
            $"SELECT `{dateColumn}` FROM `{table}` WHERE `{pkColumn}` = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = recordId });

        // No such record — let the endpoint answer 404 itself.
        if (current is null) return null;

        var denied = await ClubYearForDateAsync(user, clubId, current);
        if (denied != null) return denied;

        return newDate is null ? null : await ClubYearForDateAsync(user, clubId, newDate);
    }

    /// <summary>
    /// The district twin of <see cref="ClubRecordDateYearAsync"/>. District PPH
    /// camps share the club's <c>pph_camps</c> table (fk_club_id NULL,
    /// fk_district_id set) and have no year column either — the CampDate decides.
    ///
    /// ⚠️ Literal table/column names only; they are interpolated, because MySQL
    /// cannot parameterise identifiers.
    /// </summary>
    public async Task<ObjectResult?> DistrictRecordDateYearAsync(
        ClaimsPrincipal user, int districtId, string table, string pkColumn, int recordId,
        string dateColumn, DateTime? newDate = null)
    {
        await using var conn = await OpenAsync();
        var current = await conn.ExecuteScalarAsync<DateTime?>(
            $"SELECT `{dateColumn}` FROM `{table}` WHERE `{pkColumn}` = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = recordId });

        // No such record — let the endpoint answer 404 itself.
        if (current is null) return null;

        var denied = await DistrictYearForDateAsync(user, districtId, current);
        if (denied != null) return denied;

        return newDate is null ? null : await DistrictYearForDateAsync(user, districtId, newDate);
    }

    /// <summary>
    /// A DISTRICT acting on a record in a year-scoped table — district website
    /// banners, adverts and contact details all live in the same
    /// club_website_* tables the clubs use, keyed by the district instead.
    /// </summary>
    public async Task<ObjectResult?> DistrictRecordYearByTableAsync(
        ClaimsPrincipal user, int districtId, string table, string pkColumn, int recordId)
    {
        await using var conn = await OpenAsync();
        var yearId = await conn.ExecuteScalarAsync<int?>(
            $"SELECT fk_year_id FROM `{table}` WHERE `{pkColumn}` = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = recordId });

        // Unknown row — let the endpoint answer 404 rather than discuss years.
        if (yearId is not int y) return null;
        return await DistrictYearAsync(user, districtId, y);
    }

    // ⚠️ Make Admin is deliberately NOT guarded from here.
    //
    // It must not use the year-less rule: that asks for CURRENT-year rights and
    // so locks a past-year admin out of Make Admin altogether, including for
    // their own year — the opposite of the requirement. What it needs is a check
    // on the years BEING GRANTED, and both routes already have one:
    // AdminController.AssignRole via GetGrantableClubYearsAsync, and
    // DistrictModulesController via ResolveGrantableDistrictYearsAsync. A third
    // copy of the rule here only gave it somewhere to drift out of step.

    /// <summary>
    /// Guards a drag-and-drop REORDER of year-wise rows.
    ///
    /// ⚠️ A reorder carries only a list of ids — no year — so guarding it with the
    /// year-less rule asks for CURRENT-year rights on rows that belong to whatever
    /// year is on screen. That refuses a past-year admin reordering their own
    /// year's banners, and lets a current-year admin reshuffle another year's.
    ///
    /// Every id is checked: the list should be one year's worth, but it comes from
    /// the client, and a mixed list must not slip a foreign year through on the
    /// back of one the caller holds.
    ///
    /// ⚠️ Literal table/column names only — they are interpolated, because MySQL
    /// cannot parameterise identifiers.
    /// </summary>
    public async Task<ObjectResult?> ClubReorderYearsAsync(
        ClaimsPrincipal user, int clubId, string table, string pkColumn, IEnumerable<int> ids)
        => await ReorderYearsAsync(user, clubId, districtId: 0, table, pkColumn, ids);

    /// <summary>District twin of <see cref="ClubReorderYearsAsync"/>.</summary>
    public async Task<ObjectResult?> DistrictReorderYearsAsync(
        ClaimsPrincipal user, int districtId, string table, string pkColumn, IEnumerable<int> ids)
        => await ReorderYearsAsync(user, clubId: 0, districtId, table, pkColumn, ids);

    private async Task<ObjectResult?> ReorderYearsAsync(
        ClaimsPrincipal user, int clubId, int districtId,
        string table, string pkColumn, IEnumerable<int> ids)
    {
        var list = (ids ?? Enumerable.Empty<int>()).Where(i => i > 0).Distinct().ToList();
        if (list.Count == 0) return null;          // nothing to reorder

        await using var conn = await OpenAsync();
        var years = (await conn.QueryAsync<int?>(
            $"SELECT DISTINCT fk_year_id FROM `{table}` WHERE `{pkColumn}` IN @Ids AND COALESCE(isdeleted,0) = 0",
            new { Ids = list })).Where(y => y is int).Select(y => y!.Value).ToList();

        foreach (var y in years)
        {
            var denied = clubId > 0
                ? await ClubYearAsync(user, clubId, y)
                : await DistrictYearAsync(user, districtId, y);
            if (denied != null) return denied;
        }
        return null;
    }

    /// <summary>District twin of <see cref="ClubRecordYearAsync"/>.</summary>
    public async Task<ObjectResult?> DistrictRecordYearAsync(
        ClaimsPrincipal user, int districtId, string table, string pkColumn, int recordId)
    {
        if (recordId <= 0) return await DistrictYearlessAsync(user, districtId);

        await using var conn = await OpenAsync();
        var yearId = await conn.ExecuteScalarAsync<int?>(
            $"SELECT fk_year_id FROM `{table}` WHERE `{pkColumn}` = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = recordId });

        if (yearId is null) return null;
        return await DistrictYearAsync(user, districtId, yearId.Value);
    }

    /// <summary>
    /// District twin of <see cref="ClubRecordMoveByDateAsync"/>.
    ///
    /// Added 2026-10-28 for district newsletters, which were guarded with
    /// <see cref="DistrictYearlessAsync"/> even though they ARE year-wise:
    /// <c>newsletters.fk_year_id</c> is derived from the publish date and
    /// re-stamped on every edit, so an edit can move one between years
    /// (QA 2026-10-16, blocker B5).
    /// </summary>
    public async Task<ObjectResult?> DistrictRecordMoveByDateAsync(
        ClaimsPrincipal user, int districtId, string table, string pkColumn, int recordId, DateTime? newDate)
    {
        await using var conn = await OpenAsync();
        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            $"SELECT fk_year_id FROM `{table}` WHERE `{pkColumn}` = @Id AND COALESCE(isdeleted,0) = 0",
            new { Id = recordId });

        // No such record — let the endpoint answer 404 rather than leaking that
        // it exists by talking about years.
        if (currentYearId is not int current) return null;

        var denied = await DistrictYearAsync(user, districtId, current);
        if (denied != null) return denied;

        // Where the new date sends it. An unparseable or out-of-range date leaves
        // the record where it is, so there is no second year to check.
        return await DistrictYearForDateAsync(user, districtId, newDate);
    }

    /// <summary>The scope guard allowed this request through an elect role for exactly this scope, after checking
    /// that every year it touches is the year being planned (PlanningAccess.ElectMayWriteAsync).</summary>
    private bool ElectWriteFor(bool isClub, int scopeId) =>
        _http?.HttpContext?.Items[PlanningAccess.ElectWriteItemKey] is (bool c, int s) && c == isClub && s == scopeId;

    public async Task<ObjectResult?> ClubYearlessAsync(ClaimsPrincipal user, int clubId)
    {
        if (ElectWriteFor(true, clubId)) return null;
        await using var conn = await OpenAsync();
        var current = await AdminYearService.GetCurrentYearIdAsync(conn);
        // A missing current year is a server misconfiguration. Refuse rather than
        // fall open — falling open here would disable the feature silently.
        if (current is not int y)
            return new ObjectResult(new { message = "No current Rotary year is configured." }) { StatusCode = 500 };
        return await ClubYearAsync(user, clubId, y, yearless: true);
    }

    public async Task<ObjectResult?> DistrictYearlessAsync(ClaimsPrincipal user, int districtId)
    {
        if (ElectWriteFor(false, districtId)) return null;
        await using var conn = await OpenAsync();
        var current = await AdminYearService.GetCurrentYearIdAsync(conn);
        if (current is not int y)
            return new ObjectResult(new { message = "No current Rotary year is configured." }) { StatusCode = 500 };
        // ⚠️ yearless: true, matching ClubYearlessAsync. Without it a genuinely
        // year-less page answered "You can only edit 2025-26 — not 2026-27",
        // which points the reader at a year picker that has nothing to do with
        // the refusal. The year-less wording explains that the page is not
        // year-wise and needs CURRENT-year rights.
        return await DistrictYearAsync(user, districtId, y, yearless: true);
    }

    /// <summary>The year a record is stored under right now — the only year that
    /// may be trusted for an edit or delete.</summary>
    public async Task<(int ClubId, int YearId)?> LoadClubRecordScopeAsync(
        string table, string pkColumn, int recordId)
    {
        await using var conn = await OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<(int ClubId, int YearId)>(
            $"SELECT fk_club_id AS ClubId, fk_year_id AS YearId FROM `{table}` WHERE `{pkColumn}` = @Id",
            new { Id = recordId });
        return row.ClubId == 0 && row.YearId == 0 ? null : row;
    }

    private static async Task<string> YearLabelAsync(MySqlConnection conn, int yearId) =>
        await conn.ExecuteScalarAsync<string?>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Id", new { Id = yearId })
        ?? $"year {yearId}";

    private static async Task<List<string>> YearLabelsAsync(MySqlConnection conn, IEnumerable<int> ids)
    {
        var list = ids.ToList();
        if (list.Count == 0) return new List<string>();
        return (await conn.QueryAsync<string>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id IN @Ids ORDER BY StartDate",
            new { Ids = list })).ToList();
    }
}
