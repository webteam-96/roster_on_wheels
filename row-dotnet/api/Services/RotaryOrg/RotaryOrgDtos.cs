using System.Text.Json;
using System.Text.Json.Serialization;

namespace RotaryApi.Services.RotaryOrg;

/// <summary>
/// Rotary.org returns dates in mixed formats — sometimes empty strings, sometimes "MM/dd/yyyy",
/// sometimes ISO 8601, sometimes Unix ms numbers. System.Text.Json's default DateTime parser
/// chokes on anything but ISO. This converter accepts all these shapes.
/// </summary>
public class FlexibleDateTimeConverter : JsonConverter<DateTime?>
{
    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        if (reader.TokenType == JsonTokenType.String)
        {
            var s = reader.GetString();
            if (string.IsNullOrWhiteSpace(s)) return null;
            if (DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out var dt))
                return dt;
            if (DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt2)) return dt2;
            return null;
        }
        if (reader.TokenType == JsonTokenType.Number)
        {
            var ms = reader.GetInt64();
            return DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
        }
        return null;
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value.HasValue) writer.WriteStringValue(value.Value.ToString("yyyy-MM-ddTHH:mm:ssZ"));
        else writer.WriteNullValue();
    }
}

// Shape of POST /v1.1/authentication request body.
// Old app sent: {"Username":"...","Password":"..."} — keeping same shape.
public class RotaryOrgAuthRequest
{
    [JsonPropertyName("Username")]
    public string Username { get; set; } = "";
    [JsonPropertyName("Password")]
    public string Password { get; set; } = "";
}

// The auth response is a raw string token wrapped in JSON quotes on RI.org.
// We capture it flexibly — the client handles both bare string and object shapes.
public class RotaryOrgAuthResponse
{
    public string? Token { get; set; }
}

// Shape of GET /v1.1/clubs — returns a JSON array of these.
// Matches the ClubRootObject from the old sync app (CallAPIServices.cs:158-169).
public class RotaryOrgClubListDto
{
    public int ClubId { get; set; }
    public string? ClubType { get; set; }
    public string? ClubSubType { get; set; }
    public string? ClubName { get; set; }
    public string? ClubCountry { get; set; }
    public int? DistrictId { get; set; }
    public int? MemberCount { get; set; }
    public int? HonoraryMemberCount { get; set; }
}

// Shape of GET /v1.1/clubs/{type}/{id}?summary=false — full detail including Addresses[]
public class RotaryOrgClubDetailDto
{
    public int ClubId { get; set; }
    public string? ClubType { get; set; }
    public string? ClubSubType { get; set; }
    public string? ClubName { get; set; }
    public DateTime? CharterDate { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public int? DistrictId { get; set; }
    public string? ZoneName { get; set; }
    public string? ZoneSectionName { get; set; }
    public string? Language { get; set; }
    public List<RotaryOrgAddressDto>? Addresses { get; set; }
    public List<RotaryOrgWebsiteDto>? Websites { get; set; }
    public string? Key { get; set; }
    public DateTime? LastUpdated { get; set; }
}

public class RotaryOrgAddressDto
{
    public string? AddressType { get; set; }       // 'Meeting', 'Mailing', etc.
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? AddressLine3 { get; set; }
    public string? Country { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? PostalCode { get; set; }
    public string? MeetingName { get; set; }
    public string? MeetingDay { get; set; }
    public string? MeetingTime { get; set; }
    public string? MeetingComment { get; set; }
    public string? MeetingType { get; set; }
    public string? OnlineLocation { get; set; }
    public string? MeetinglocationVariesFlag { get; set; }
    public string? MeetingLocationName { get; set; }
    public bool? IsPrimary { get; set; }
}

public class RotaryOrgWebsiteDto
{
    public string? WebsiteUrl { get; set; }
    public string? WebsiteType { get; set; }
}

// Our own cached token with expiry. In-memory only (one process; TTL-based refresh).
internal class CachedRotaryOrgToken
{
    public string Token { get; set; } = "";
    public DateTime ExpiresAtUtc { get; set; }
    public bool IsExpired => DateTime.UtcNow >= ExpiresAtUtc;
}

// ─── /Clubs/search?country=...&type=Rotary Club — used by SuperAdmin manual sync ───
public class RotaryOrgClubSearchDto
{
    public int ClubId { get; set; }
    public string? ClubName { get; set; }
    public string? ClubType { get; set; }
    public string? ClubSubType { get; set; }
    public DateTime? CharterDate { get; set; }
    public int? NumberOfActiveMembers { get; set; }
    public RotaryOrgSearchLocationDto? Location { get; set; }
    public string? ClubLanguage { get; set; }
    public string? District { get; set; }   // district number as string
    public string? Website { get; set; }
    public string? Email { get; set; }
    public RotaryOrgSearchAddressDto? Address { get; set; }
}

public class RotaryOrgSearchLocationDto
{
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
}

public class RotaryOrgSearchAddressDto
{
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? AddressLine3 { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PostalCode { get; set; }
    public string? Country { get; set; }
}

// ─── /clubs/{type}/{id}/members/0/1500/Active ───
public class RotaryOrgClubMembersResponse
{
    public List<RotaryOrgClubMemberDto>? ClubMembers { get; set; }
}

public class RotaryOrgClubMemberDto
{
    public long MemberId { get; set; }
    public string? BadgeName { get; set; }
    public string? LocalizedName { get; set; }
    public string? Prefix { get; set; }
    public string? FirstName { get; set; }
    public string? MiddleName { get; set; }
    public string? LastName { get; set; }
    public string? Suffix { get; set; }
    public DateTime? AdmissionDate { get; set; }
    public DateTime? TerminationDate { get; set; }
    public string? TerminationReason { get; set; }
    public string? BirthYear { get; set; }
    public string? MemberType { get; set; }
}

// ─── /individuals/{id}/profile ───
public class RotaryOrgIndividualProfileResponse
{
    public RotaryOrgIndividualDto? Individual { get; set; }
    public List<RotaryOrgIndividualAddressDto>? Address { get; set; }
    public List<RotaryOrgIndividualPhoneDto>? Phone { get; set; }
    public List<RotaryOrgIndividualEmailDto>? Email { get; set; }
}

public class RotaryOrgIndividualDto
{
    public long MemberId { get; set; }
    public string? Prefix { get; set; }
    public string? FirstName { get; set; }
    public string? MiddleName { get; set; }
    public string? LastName { get; set; }
    public string? Suffix { get; set; }
    public string? LocalizedName { get; set; }
    public string? Gender { get; set; }
    public string? GenderDescription { get; set; }
    public string? DateOfBirth { get; set; }
    public string? PrimaryLanguage { get; set; }
    public string? Classification { get; set; }
    public bool? YouthFlag { get; set; }
}

public class RotaryOrgIndividualAddressDto
{
    public string? AddressType { get; set; }
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? AddressLine3 { get; set; }
    public string? Country { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? PostalCode { get; set; }
    public bool? IsPrimary { get; set; }
}

public class RotaryOrgIndividualPhoneDto
{
    public string? PhoneType { get; set; }
    public string? PhoneNumber { get; set; }
    public string? CountryCode { get; set; }
    public bool? IsPrimary { get; set; }
}

public class RotaryOrgIndividualEmailDto
{
    public string? EmailAddress { get; set; }
    public string? EmailType { get; set; }
    public bool? IsPrimary { get; set; }
}

// One officer row from Rotary.org /clubs/{type}/{id}/officers (defensively mapped).
public class RotaryOrgClubOfficerDto
{
    public string? Role { get; set; }
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    // Rotary.org individual/member id → matched against member_master_profile.RotaryId
    // to fill email/mobile from our own DB when the API omits them.
    public string? RotaryId { get; set; }
}
