using System.Text.Json;
using System.Text.Json.Serialization;

namespace RotaryOrgSyncWorker.Services;

// Rotary.org sends DateTime fields in non-ISO formats (e.g. "12/01/2023" or
// "2023-04-15 00:00:00") that System.Text.Json's strict parser rejects.
// This converter falls back to DateTime.TryParse which handles many formats.
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

public class RotaryOrgAuthRequest
{
    [JsonPropertyName("Username")]
    public string Username { get; set; } = "";
    [JsonPropertyName("Password")]
    public string Password { get; set; } = "";
}

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
    public string? Language { get; set; }
    public List<RotaryOrgAddressDto>? Addresses { get; set; }
    public DateTime? LastUpdated { get; set; }
}

public class RotaryOrgAddressDto
{
    public string? AddressType { get; set; }
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? AddressLine3 { get; set; }
    public string? Country { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? PostalCode { get; set; }
    // Prepended to the MeetingAddress concat so the club's meeting venue name
    // (e.g. "Wisdom Chamber") is preserved. Added 2026-07-10 — was silently
    // dropped from /clubs/{name}/{id} responses because the field didn't exist.
    public string? MeetingName { get; set; }
    public string? MeetingDay { get; set; }
    public string? MeetingTime { get; set; }
    public bool? IsPrimary { get; set; }
}

// Shape of GET /v1.1/Clubs/search response — flatter than detail. CharterDate is "MM/dd/yyyy".
// Contains nested Location and Address objects.
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
    public string? District { get; set; }   // string in this endpoint
    public string? Website { get; set; }
    public string? Email { get; set; }
    // Top-level fields, NOT nested under Location — confirmed against a live API response.
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public RotaryOrgSearchAddressDto? Address { get; set; }
}

public class RotaryOrgSearchLocationDto
{
    public string? State { get; set; }
    public string? InternationalProvince { get; set; }
    public string? Country { get; set; }
}

public class RotaryOrgSearchAddressDto
{
    public string? AddressType { get; set; }
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? Country { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? PostalCode { get; set; }
    public string? MeetingName { get; set; }
    public string? MeetingDay { get; set; }
    public string? MeetingTime { get; set; }   // "HHMM" format like "1900"
    // Rotary.org returns MANY Address rows per club under this same search endpoint —
    // apparently one per historical meeting/activity log entry, not one per club. The row
    // with the max LastUpdated is the one that matches Rotary.org's own Club Locator app.
    public string? Key { get; set; }
    public DateTime? LastUpdated { get; set; }
}

// Shape of /v1.1/individuals/updates response items — these are CHANGE NOTIFICATIONS only,
// not full member data. To get details, fetch /individuals/{MemberId} for each unique MemberId.
public class RotaryOrgMemberUpdateNotificationDto
{
    public long MemberId { get; set; }
    public string? EntityType { get; set; }   // "Email", "Address", "Phone", "IndividualDemographics", etc.
    public string? Key { get; set; }
    public DateTime? LastUpdated { get; set; }
}

// Shape of /v1.1/individuals/{id} full detail response — basic personal profile only.
// Club info / membership dates / contact info come from SEPARATE endpoints, not this one.
public class RotaryOrgMemberDto
{
    public long MemberId { get; set; }
    public string? Prefix { get; set; }
    public string? FirstName { get; set; }
    public string? MiddleName { get; set; }
    public string? LastName { get; set; }
    public string? Suffix { get; set; }
    public string? BadgeName { get; set; }
    public string? LocalizedName { get; set; }       // formatted full name — preferred for display
    public string? Gender { get; set; }
    public string? GenderDescription { get; set; }
    public string? DateOfBirth { get; set; }          // string format like "12/15/1977" — may be empty
    public string? PrimaryLanguage { get; set; }
    public string? Classification { get; set; }
    public bool? YouthFlag { get; set; }
    public string? Key { get; set; }
    public DateTime? LastUpdated { get; set; }
}

// Shape of /v1.1/clubs/{clubType}/{clubId}/members/{offset}/{limit}/Active response.
// Wrapper contains a "ClubMembers" array with basic per-member rows.
public class RotaryOrgClubMembersResponse
{
    public List<RotaryOrgClubMemberDto>? ClubMembers { get; set; }
}

public class RotaryOrgClubMemberDto
{
    public long MemberId { get; set; }
    public string? BadgeName { get; set; }
    public string? LocalizedName { get; set; }
    public string? Key { get; set; }
    public string? Prefix { get; set; }
    public string? FirstName { get; set; }
    public string? MiddleName { get; set; }
    public string? LastName { get; set; }
    public string? Suffix { get; set; }
    public DateTime? AdmissionDate { get; set; }
    public DateTime? TerminationDate { get; set; }
    public string? TerminationReason { get; set; }
    public string? BirthYear { get; set; }      // "1980" or ""
    public string? MemberType { get; set; }     // "Member", "Honorary Member"
}

// Shape of /v1.1/individuals/{memberId}/profile — wrapper with Individual + contact arrays.
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
    public string? BadgeName { get; set; }
    public string? LocalizedName { get; set; }
    public string? Gender { get; set; }
    public string? GenderDescription { get; set; }
    public string? DateOfBirth { get; set; }    // "02/26/1980"
    public string? PrimaryLanguage { get; set; }
    public string? Classification { get; set; }
    public bool? YouthFlag { get; set; }
}

public class RotaryOrgIndividualAddressDto
{
    public string? AddressType { get; set; }    // "Home", "Business"
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
    public string? PhoneType { get; set; }      // "Mobile", "Home", "Business"
    public string? PhoneNumber { get; set; }
    public string? CountryCode { get; set; }        // dial code WITHOUT '+', e.g. "94" (Sri Lanka), "91" (India)
    public string? PhoneCountryName { get; set; }   // e.g. "Sri Lanka" — backup for country resolution
    public bool? IsPrimary { get; set; }
}

public class RotaryOrgIndividualEmailDto
{
    public string? EmailAddress { get; set; }
    public string? EmailType { get; set; }      // "Personal", "Business"
    public bool? IsPrimary { get; set; }
}

// Shape of /v1.1/clubs/{clubType}/{clubId}/officers?startDate=&endDate= response.
// Flat array of officers — one row per officer position per year.
public class RotaryOrgClubOfficerDto
{
    public long MemberId { get; set; }
    public int ClubId { get; set; }
    public string? OfficerRole { get; set; }    // designation name e.g. "Club President", "Club Secretary"
    public DateTime? StartDate { get; set; }    // typically 07/01/YYYY
    public DateTime? EndDate { get; set; }      // typically 06/30/YYYY
    public string? ClubName { get; set; }
    public string? FirstName { get; set; }
    public string? MiddleName { get; set; }
    public string? LastName { get; set; }
    public string? Suffix { get; set; }
    public string? Key { get; set; }
    public DateTime? LastUpdated { get; set; }
}

internal class CachedRotaryOrgToken
{
    public string Token { get; set; } = "";
    public DateTime ExpiresAtUtc { get; set; }
    public bool IsExpired => DateTime.UtcNow >= ExpiresAtUtc;
}
