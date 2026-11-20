namespace RotaryApi.DTOs;

// Group messages (user 2026-10-19). One row per group the viewer belongs to in a zone + year.
//   Kind "District"  : one district + one category - DG / District Admins, the category's co-ordinators,
//                      the assistants covering that district and the RI Director.
//   Kind "Team"      : a co-ordinator designation with its own assistants (RRFC + ARRFCs) + RI Director.
//   Kind "Broadcast" : the sender's own "All my districts" box - one message goes into each district group.
public class GoalGroupDto
{
    public string Key { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Sub { get; set; }
    public int CategoryId { get; set; }
    public string? CategoryName { get; set; }
    public int DistrictId { get; set; }
    public string? DistrictNumber { get; set; }
    public int MemberCount { get; set; }
    public int MessageCount { get; set; }
    public int UnreadCount { get; set; }
    public string? LastMessagePreview { get; set; }
    public string? LastMessageDate { get; set; }
    public bool CanPost { get; set; }
}

public class GoalGroupMemberDto
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public string Role { get; set; } = "";
}

public class GoalGroupConversationDto
{
    public GoalGroupDto Group { get; set; } = new();
    public List<GoalGroupMemberDto> Members { get; set; } = new();
    public List<GoalCommentDto> Messages { get; set; } = new();
}

public class PostGoalGroupMessageRequest
{
    public string CommentText { get; set; } = "";
}
