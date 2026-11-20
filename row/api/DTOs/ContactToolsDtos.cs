namespace RotaryApi.DTOs;

// Contacts export, duplicate merge and Friends of the club (gap agent, 2026-11-19).

public class ContactDuplicateGroupDto
{
    public List<ContactDto> Contacts { get; set; } = new();
    /// <summary>Same email, Same phone, Same name.</summary>
    public List<string> Reasons { get; set; } = new();
}

public class MergeContactsRequest
{
    /// <summary>The contact that stays (its id, history and links are kept).</summary>
    public int SurvivorId { get; set; }
    /// <summary>The contacts folded into the survivor and then removed.</summary>
    public List<int> MergeIds { get; set; } = new();
    /// <summary>Field (name, email, mobile, contactType, organisation, notes) to the contact id whose value wins.
    /// A field left out keeps the survivor's value, or the first non-blank one of the others.</summary>
    public Dictionary<string, int>? FieldSources { get; set; }
}

public class ContactMergeHistoryDto
{
    public int Id { get; set; }
    public int MergedContactId { get; set; }
    /// <summary>The merged contact as it was just before the merge.</summary>
    public ContactDto Merged { get; set; } = new();
    public string? MergedBy { get; set; }
    public DateTime MergedDateUtc { get; set; }
}
