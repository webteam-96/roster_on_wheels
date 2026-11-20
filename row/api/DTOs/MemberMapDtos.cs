namespace RotaryApi.DTOs;

// Member map and business directory (Services/MemberMapService.cs).

public class SaveMapPinDto
{
    public bool ShowOnMap { get; set; }
    public string? City { get; set; }
    public string? Area { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
}

public record MemberClubDto(int ClubId, string ClubName, int DistrictId);

public record MyMapPinDto(bool ShowOnMap, string? City, string? Area, decimal? Latitude, decimal? Longitude, List<MemberClubDto> Clubs);

public record MapMemberDto(string Name, string ClubName, string? City, string? Area, decimal Latitude, decimal Longitude);

public record MeetingPlaceDto(int ClubId, string ClubName, string? MeetingAddress, string? MeetingDay, string? MeetingFromTime,
    string? MeetingToTime, decimal Latitude, decimal Longitude);

public record MemberMapDto(List<MapMemberDto> Members, List<MeetingPlaceDto> MeetingPlaces);

public class SaveBusinessListingDto
{
    public int ClubId { get; set; }
    public string? BusinessName { get; set; }
    public string? Classification { get; set; }
    public string? Description { get; set; }
    public string? Website { get; set; }
    public string? Phone { get; set; }
}

public class ReviewBusinessListingDto
{
    public bool Approve { get; set; }
    public string? Note { get; set; }
}

public class BusinessListingDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string MemberName { get; set; } = "";
    public string BusinessName { get; set; } = "";
    public string? Classification { get; set; }
    public string? Description { get; set; }
    public string? Website { get; set; }
    public string? Phone { get; set; }
    public string Status { get; set; } = "pending";
    public string? ReviewNote { get; set; }
    public DateTime ModifiedUtc { get; set; }
}

public record MyBusinessListingDto(BusinessListingDto? Listing, List<MemberClubDto> Clubs);
