using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Member map and business directory (competitor gap, 2026-11-19). Who may call what: MemberMapController.
/// Map: a member opts in with a city, an area and a point that is rounded to about 1 km before it is stored, so no
/// one (admins included) can read a home address from it. Clubs' meeting places come from club_master.
/// Directory: a member lists one business; it shows district-wide (app, admin, club website) once a club or district
/// admin approves it, and any edit sends it back for approval.
/// </summary>
public partial class MemberMapService
{
    private readonly string _cs;

    public MemberMapService(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    // ───────────── pure rules (unit-tested) ─────────────

    /// <summary>Two decimals is about 1.1 km: enough for "which part of town", never a house.</summary>
    public static decimal Approximate(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>Checks and rounds an opt-in; throws InvalidOperationException (400) on bad input.</summary>
    public static SaveMapPinDto NormalizePin(SaveMapPinDto d)
    {
        if (!d.ShowOnMap) return new SaveMapPinDto();
        if (d.Latitude is not { } lat || d.Longitude is not { } lng)
            throw new InvalidOperationException("Pick your approximate place on the map first.");
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new InvalidOperationException("That place is not on the map.");
        return new SaveMapPinDto
        {
            ShowOnMap = true,
            City = VolunteerService.Clean(d.City, 100, "The city"),
            Area = VolunteerService.Clean(d.Area, 100, "The area"),
            Latitude = Approximate(lat),
            Longitude = Approximate(lng),
        };
    }

    [GeneratedRegex(@"^[0-9+()\-. ]{5,40}$")]
    private static partial Regex PhoneShape();

    public static SaveBusinessListingDto NormalizeListing(SaveBusinessListingDto d)
    {
        var name = VolunteerService.Clean(d.BusinessName, 200, "The business name");
        if (name is null || name.Length < 2) throw new InvalidOperationException("Enter the business name.");
        var website = VolunteerService.Clean(d.Website, 300, "The website");
        if (website != null && !UrlValidator.IsValidWebUrl(website))
            throw new InvalidOperationException("Enter the website with http:// or https:// (for example https://example.com).");
        var phone = VolunteerService.Clean(d.Phone, 40, "The phone number");
        if (phone != null && !PhoneShape().IsMatch(phone))
            throw new InvalidOperationException("The phone number has digits, spaces and + ( ) - . only.");
        return new SaveBusinessListingDto
        {
            ClubId = d.ClubId,
            BusinessName = name,
            Classification = VolunteerService.Clean(d.Classification, 150, "The classification"),
            Description = VolunteerService.Clean(d.Description, 2000, "The description"),
            Website = website,
            Phone = phone,
        };
    }

    // ───────────── shared reads ─────────────

    private const string ActiveMembership = "cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0";

    private async Task<List<MemberClubDto>> ClubsOfAsync(MySqlConnection c, int memberId) =>
        (await c.QueryAsync<MemberClubDto>($@"
            SELECT DISTINCT c.pk_club_id AS ClubId, c.ClubName, c.fk_district_id AS DistrictId
            FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE cm.fk_member_master_profile_id = @memberId AND {ActiveMembership}
              AND IFNULL(c.isdeleted, 0) = 0 AND {HierarchyScopeSql.ClubLive("c")}
            ORDER BY c.ClubName", new { memberId })).ToList();

    // ───────────── map ─────────────

    public async Task<MyMapPinDto> MyPinAsync(int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        var p = await c.QueryFirstOrDefaultAsync<SaveMapPinDto>(
            "SELECT city AS City, area AS Area, latitude AS Latitude, longitude AS Longitude FROM member_map_pins WHERE fk_member_id = @memberId",
            new { memberId });
        var clubs = await ClubsOfAsync(c, memberId);
        return p != null
            ? new MyMapPinDto(true, p.City, p.Area, p.Latitude, p.Longitude, clubs)
            : new MyMapPinDto(false, null, null, null, null, clubs);
    }

    /// <summary>Opting out deletes the pin outright.</summary>
    public async Task<MyMapPinDto> SavePinAsync(int memberId, SaveMapPinDto dto)
    {
        var d = NormalizePin(dto);
        await using (var c = new MySqlConnection(_cs))
        {
            if (!d.ShowOnMap)
                await c.ExecuteAsync("DELETE FROM member_map_pins WHERE fk_member_id = @memberId", new { memberId });
            else
                await c.ExecuteAsync(@"
                    INSERT INTO member_map_pins (fk_member_id, city, area, latitude, longitude, modified_utc)
                    VALUES (@memberId, @City, @Area, @Latitude, @Longitude, UTC_TIMESTAMP())
                    ON DUPLICATE KEY UPDATE city = VALUES(city), area = VALUES(area), latitude = VALUES(latitude),
                        longitude = VALUES(longitude), modified_utc = UTC_TIMESTAMP()",
                    new { memberId, d.City, d.Area, d.Latitude, d.Longitude });
        }
        return await MyPinAsync(memberId);
    }

    /// <summary>The opted-in members and the meeting places of one club (isClub) or of a district's live clubs.</summary>
    public async Task<MemberMapDto> MapAsync(bool isClub, int scopeId)
    {
        var scope = isClub ? "c.pk_club_id = @scopeId" : "c.fk_district_id = @scopeId";
        var live = $"IFNULL(c.isdeleted, 0) = 0 AND {HierarchyScopeSql.ClubLive("c")}";
        await using var c = new MySqlConnection(_cs);
        // A member of two clubs in the district shows once, under the first club.
        // shortcut: 5000 pins per map, enough for the largest district; cluster on the client when that changes.
        var members = (await c.QueryAsync<MapMemberDto>($@"
            SELECT m.MemberName AS Name, MIN(c.ClubName) AS ClubName, p.city AS City, p.area AS Area,
                   p.latitude AS Latitude, p.longitude AS Longitude
            FROM member_map_pins p
            JOIN member_master_profile m ON m.pk_member_master_profile_id = p.fk_member_id AND IFNULL(m.isdeleted, 0) = 0
            JOIN club_members cm ON cm.fk_member_master_profile_id = p.fk_member_id AND {ActiveMembership}
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE {scope} AND {live}
            GROUP BY p.fk_member_id, m.MemberName, p.city, p.area, p.latitude, p.longitude
            ORDER BY p.city, m.MemberName LIMIT 5000", new { scopeId })).ToList();
        var places = (await c.QueryAsync<MeetingPlaceDto>($@"
            SELECT c.pk_club_id AS ClubId, c.ClubName, c.MeetingAddress, c.MeetingDay,
                   TIME_FORMAT(c.MeetingFromTime, '%H:%i') AS MeetingFromTime, TIME_FORMAT(c.MeetingToTime, '%H:%i') AS MeetingToTime,
                   c.Latitude, c.Longitude
            FROM club_master c
            WHERE {scope} AND {live} AND c.Latitude IS NOT NULL AND c.Longitude IS NOT NULL
              AND NOT (c.Latitude = 0 AND c.Longitude = 0)
            ORDER BY c.ClubName", new { scopeId })).ToList();
        return new MemberMapDto(members, places);
    }

    // ───────────── business directory ─────────────

    private const string ListingSelect = @"
        SELECT b.pk_listing_id AS Id, b.fk_club_id AS ClubId, c.ClubName, m.MemberName, b.business_name AS BusinessName,
               b.classification AS Classification, b.description AS Description, b.website AS Website, b.phone AS Phone,
               b.status AS Status, b.review_note AS ReviewNote, b.modified_utc AS ModifiedUtc
        FROM business_listings b
        JOIN club_master c ON c.pk_club_id = b.fk_club_id
        JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_id";

    public async Task<MyBusinessListingDto> MyListingAsync(int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        var listing = await c.QueryFirstOrDefaultAsync<BusinessListingDto>(ListingSelect + " WHERE b.fk_member_id = @memberId", new { memberId });
        return new MyBusinessListingDto(listing, await ClubsOfAsync(c, memberId));
    }

    public async Task<MyBusinessListingDto> SaveListingAsync(int memberId, SaveBusinessListingDto dto)
    {
        var d = NormalizeListing(dto);
        await using (var c = new MySqlConnection(_cs))
        {
            var club = (await ClubsOfAsync(c, memberId)).FirstOrDefault(x => x.ClubId == d.ClubId)
                ?? throw new InvalidOperationException("Pick one of your own clubs for the listing.");
            await c.ExecuteAsync(@"
                INSERT INTO business_listings (fk_member_id, fk_club_id, fk_district_id, business_name, classification, description,
                    website, phone, status, created_utc, modified_utc)
                VALUES (@memberId, @ClubId, @DistrictId, @BusinessName, @Classification, @Description, @Website, @Phone, 'pending',
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
                ON DUPLICATE KEY UPDATE fk_club_id = VALUES(fk_club_id), fk_district_id = VALUES(fk_district_id),
                    business_name = VALUES(business_name), classification = VALUES(classification), description = VALUES(description),
                    website = VALUES(website), phone = VALUES(phone), status = 'pending', review_note = NULL, reviewed_by = NULL,
                    reviewed_utc = NULL, modified_utc = UTC_TIMESTAMP()",
                new { memberId, club.ClubId, club.DistrictId, d.BusinessName, d.Classification, d.Description, d.Website, d.Phone });
        }
        return await MyListingAsync(memberId);
    }

    public async Task<bool> DeleteMyListingAsync(int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.ExecuteAsync("DELETE FROM business_listings WHERE fk_member_id = @memberId", new { memberId }) > 0;
    }

    /// <summary>Approved listings of a district, newest first, matching q in any text field.</summary>
    public async Task<List<BusinessListingDto>> SearchAsync(int districtId, string? q)
    {
        q = q?.Trim();
        if (q?.Length > 100) q = q[..100];
        await using var c = new MySqlConnection(_cs);
        // shortcut: LIKE scan capped at 200 rows; add a FULLTEXT index when a district passes a few thousand listings.
        return (await c.QueryAsync<BusinessListingDto>(ListingSelect + $@"
            WHERE b.fk_district_id = @districtId AND b.status = 'approved' AND IFNULL(m.isdeleted, 0) = 0
              AND IFNULL(c.isdeleted, 0) = 0 AND {HierarchyScopeSql.ClubLive("c")}
              AND (@like IS NULL OR b.business_name LIKE @like OR b.classification LIKE @like OR b.description LIKE @like
                   OR m.MemberName LIKE @like OR c.ClubName LIKE @like)
            ORDER BY b.business_name LIMIT 200",
            new { districtId, like = string.IsNullOrEmpty(q) ? null : "%" + EscapeLike(q) + "%" })).ToList();
    }

    private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>The district of a live club, or null.</summary>
    public async Task<int?> DistrictOfClubAsync(int clubId)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.ExecuteScalarAsync<int?>($@"
            SELECT c.fk_district_id FROM club_master c
            WHERE c.pk_club_id = @clubId AND IFNULL(c.isdeleted, 0) = 0 AND {HierarchyScopeSql.ClubLive("c")}", new { clubId });
    }

    /// <summary>Listings for review: one club's (isClub) or a whole district's; status null means all.</summary>
    public async Task<List<BusinessListingDto>> ReviewListAsync(bool isClub, int scopeId, string? status)
    {
        if (status is not (null or "" or "pending" or "approved" or "rejected"))
            throw new InvalidOperationException("Status is pending, approved or rejected.");
        await using var c = new MySqlConnection(_cs);
        return (await c.QueryAsync<BusinessListingDto>(ListingSelect + $@"
            WHERE {(isClub ? "b.fk_club_id" : "b.fk_district_id")} = @scopeId AND (@status IS NULL OR b.status = @status)
            ORDER BY b.status = 'pending' DESC, b.modified_utc DESC LIMIT 500",
            new { scopeId, status = string.IsNullOrEmpty(status) ? null : status })).ToList();
    }

    public sealed class ListingScope { public int ClubId { get; set; } public int DistrictId { get; set; } }

    public async Task<ListingScope?> ListingScopeAsync(int id)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.QueryFirstOrDefaultAsync<ListingScope>(
            "SELECT fk_club_id AS ClubId, fk_district_id AS DistrictId FROM business_listings WHERE pk_listing_id = @id", new { id });
    }

    public async Task<BusinessListingDto?> ReviewAsync(int id, ReviewBusinessListingDto dto, int reviewerId)
    {
        var note = VolunteerService.Clean(dto.Note, 500, "The note");
        if (!dto.Approve && note is null) throw new InvalidOperationException("Say why the listing is not approved.");
        await using var c = new MySqlConnection(_cs);
        await c.ExecuteAsync(@"
            UPDATE business_listings SET status = @status, review_note = @note, reviewed_by = @reviewerId, reviewed_utc = UTC_TIMESTAMP()
            WHERE pk_listing_id = @id", new { id, status = dto.Approve ? "approved" : "rejected", note, reviewerId });
        return await c.QueryFirstOrDefaultAsync<BusinessListingDto>(ListingSelect + " WHERE b.pk_listing_id = @id", new { id });
    }
}
