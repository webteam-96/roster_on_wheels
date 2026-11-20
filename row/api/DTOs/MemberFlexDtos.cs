using System.Text.Json.Serialization;

namespace RotaryApi.DTOs;

// Member flexibility (gap agent, 2026-11-19): tags, custom profile fields, smart lists.

public class ClubTagDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "";
    public int MemberCount { get; set; }
    public int ContactCount { get; set; }
}

public class SaveClubTagDto
{
    public string? Name { get; set; }
    public string? Color { get; set; }
}

public class SetTagsDto
{
    public List<int> TagIds { get; set; } = new();
}

public class ProfileFieldDto
{
    public int Id { get; set; }
    public string Label { get; set; } = "";
    public string FieldType { get; set; } = "text";
    public List<string> Options { get; set; } = new();
    public string Visibility { get; set; } = "admins";
    public int SortOrder { get; set; }
}

public class SaveProfileFieldDto
{
    public string? Label { get; set; }
    public string? FieldType { get; set; }
    public List<string>? Options { get; set; }
    public string? Visibility { get; set; }
    public int SortOrder { get; set; }
}

public class ProfileFieldValueDto : ProfileFieldDto
{
    public string? Value { get; set; }
}

public class ProfileValueInput
{
    public int FieldId { get; set; }
    public string? Value { get; set; }
}

public class SaveProfileValuesDto
{
    public List<ProfileValueInput> Values { get; set; } = new();
}

/// <summary>A smart list's filter. Every part is optional; the parts are combined with AND.</summary>
public class SmartListFilter
{
    public string? Search { get; set; }
    public List<int>? TagIds { get; set; }
    /// <summary>"any" (default) or "all".</summary>
    public string? TagMode { get; set; }
    /// <summary>null, "active" or "honorary".</summary>
    public string? MemberType { get; set; }
    /// <summary>yyyy-MM-dd, inclusive.</summary>
    public string? JoinedFrom { get; set; }
    public string? JoinedTo { get; set; }
    /// <summary>Club committees (sub groups) the member sits on (any of).</summary>
    public List<int>? SubGroupIds { get; set; }
    public List<FieldCondition>? Fields { get; set; }
}

public class FieldCondition
{
    public int FieldId { get; set; }
    /// <summary>set, notset, eq, contains (text), gt / lt (number), before / after (date).</summary>
    public string Op { get; set; } = "eq";
    public string? Value { get; set; }
}

public class SmartListDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public SmartListFilter Filter { get; set; } = new();
    public DateTime CreatedDate { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

public class SaveSmartListDto
{
    public string? Name { get; set; }
    public SmartListFilter Filter { get; set; } = new();
}

public class SmartListPreviewRequest
{
    public SmartListFilter Filter { get; set; } = new();
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
}

public class SmartListMemberDto
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public DateTime? JoinedDate { get; set; }
    public bool IsHonorary { get; set; }
    [JsonIgnore] public string? TagIdsCsv { get; set; }
    public List<int> TagIds => (TagIdsCsv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();
}

public class SmartListMassEmailRequest
{
    public string? FromName { get; set; }
    public string? Subject { get; set; }
}

public class ClubSubGroupOptionDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
}
