namespace RotaryApi.DTOs;

// District speaker bureau (gap #13 part 2, 2026-11-19): Services/SpeakerBureauService.cs.

/// <summary>A bureau speaker. Topics and languages are comma-separated tags. Email and phone go only to members of
/// the district (every bureau route checks that). Status: pending (proposed by a club), approved (listed), rejected.</summary>
public class BureauEntryDto
{
    public int Id { get; set; }
    public int DistrictId { get; set; }
    public string Name { get; set; } = "";
    public string? Bio { get; set; }
    public string Topics { get; set; } = "";
    public string Languages { get; set; } = "";
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? City { get; set; }
    public bool AvailableOnline { get; set; }
    public bool AvailableInPerson { get; set; }
    public string? PhotoPath { get; set; }
    public int? MemberId { get; set; }
    public string? MemberName { get; set; }
    public string Status { get; set; } = "pending";
    public int? ProposedByClubId { get; set; }
    public string? ProposedByClubName { get; set; }
    public double? AverageRating { get; set; }
    public int RatingCount { get; set; }
    public int TalkCount { get; set; }
}

public class SaveBureauEntryDto
{
    public string Name { get; set; } = "";
    public string? Bio { get; set; }
    public string? Topics { get; set; }
    public string? Languages { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? City { get; set; }
    public bool AvailableOnline { get; set; }
    public bool AvailableInPerson { get; set; } = true;
    public int? MemberId { get; set; }
}

public class BureauSearchDto
{
    public string? Topic { get; set; }
    public string? Language { get; set; }
    /// <summary>online or in_person; anything else means either.</summary>
    public string? Mode { get; set; }
    public double? MinRating { get; set; }
    /// <summary>District managers only: pending, approved or rejected; members always get approved.</summary>
    public string? Status { get; set; }
}

public class BureauRatingDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string? ClubName { get; set; }
    public DateTime TalkDate { get; set; }
    public int Rating { get; set; }
    public string? Comment { get; set; }
    public bool CommentHidden { get; set; }
    public DateTime CreatedDate { get; set; }
}

public class BureauProfileDto
{
    public BureauEntryDto Entry { get; set; } = new();
    public List<BureauRatingDto> Ratings { get; set; } = new();
}

public class BureauStatusDto
{
    public string Status { get; set; } = "";
}

public class BureauTalkDto
{
    public DateTime TalkDate { get; set; }
}

/// <summary>A club's booking (talk) of a bureau speaker. CanRate: the talk date has come and the club has not rated it.</summary>
public class BureauBookingDto
{
    public int Id { get; set; }
    public int EntryId { get; set; }
    public string Name { get; set; } = "";
    public string Topics { get; set; } = "";
    public DateTime TalkDate { get; set; }
    public int? Rating { get; set; }
    public string? Comment { get; set; }
    public bool CanRate { get; set; }
}

public class SaveBureauRatingDto
{
    public DateTime TalkDate { get; set; }
    public int Rating { get; set; }
    public string? Comment { get; set; }
}

public class HideBureauCommentDto
{
    public bool Hidden { get; set; } = true;
}
