namespace RotaryApi.DTOs;

public class PagedResult<T>
{
    public List<T> Items { get; set; } = new();
    public int TotalCount { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalPages => (int)Math.Ceiling((double)TotalCount / PageSize);

    // Club-member endpoints split the club roster into regular vs honorary. Nullable so every
    // other paginated endpoint leaves them unset (omitted from JSON). memberCount = non-honorary,
    // honoraryCount = honorary; memberCount + honoraryCount = the club's active roster size.
    public int? MemberCount { get; set; }
    public int? HonoraryCount { get; set; }
}
