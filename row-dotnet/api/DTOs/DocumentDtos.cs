namespace RotaryApi.DTOs;

public class DocumentListDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public string AccessType { get; set; } = "downloadable";
    public string FilePath { get; set; } = "";
    public string? OriginalFileName { get; set; }
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public string Status { get; set; } = "";
}

public class DocumentDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Title { get; set; } = "";
    public string AccessType { get; set; } = "downloadable";
    public string FilePath { get; set; } = "";
    public string? OriginalFileName { get; set; }
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
    public string Status { get; set; } = "";
}

public class CreateDocumentDto
{
    public string Title { get; set; } = "";
    public string AccessType { get; set; } = "downloadable";
    public string FilePath { get; set; } = "";
    public string? OriginalFileName { get; set; }
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
}

public class UpdateDocumentDto
{
    public string Title { get; set; } = "";
    public string AccessType { get; set; } = "downloadable";
    public string FilePath { get; set; } = "";
    public string? OriginalFileName { get; set; }
    public DateTime PublishDateTime { get; set; }
    public DateTime ExpiryDateTime { get; set; }
}
