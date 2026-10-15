namespace RotaryApi.DTOs;

public class PastPresidentDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int? MemberId { get; set; }                  // NULLable — null when this is a non-member entry
    public string? NonMemberName { get; set; }          // non-member display name (null for member entries)
    public bool IsMember { get; set; }                  // computed in SQL: MemberId IS NOT NULL → 1
    public string MemberName { get; set; } = "";        // resolves to real member name OR NonMemberName
    public string? ProfilePhotoPath { get; set; }       // NULL for non-members
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
}

public class CreatePastPresidentDto
{
    public int? MemberId { get; set; }                  // NULLable — supply either MemberId OR NonMemberName, not both
    public string? NonMemberName { get; set; }
    public int YearId { get; set; }
}

public class UpdatePastPresidentDto
{
    public int? MemberId { get; set; }
    public string? NonMemberName { get; set; }
    public int YearId { get; set; }
    // Non-member only: when true (and no new photo is uploaded) the existing photo is removed.
    public bool RemovePhoto { get; set; }
}

public class ClubMemberSearchDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = "";
    public string? ProfilePhotoPath { get; set; }
}
