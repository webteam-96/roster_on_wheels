namespace RotaryApi.DTOs;

/// <summary>A mass email template: a ROW starter (Id 0, Key set, read-only) or one the club or district saved.</summary>
public class MassEmailTemplateDto
{
    public int Id { get; set; }
    public string? Key { get; set; }
    public string Name { get; set; } = "";
    public string Subject { get; set; } = "";
    public string BodyHtml { get; set; } = "";
    public bool IsStarter { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

public class SaveMassEmailTemplateDto
{
    public string Name { get; set; } = "";
    public string Subject { get; set; } = "";
    public string BodyHtml { get; set; } = "";
}

public record MergeFieldDto(string Token, string Label);

public class MassEmailTemplateLibraryDto
{
    public List<MassEmailTemplateDto> Starters { get; set; } = new();
    public List<MassEmailTemplateDto> Saved { get; set; } = new();
    public List<MergeFieldDto> MergeFields { get; set; } = new();
}

public class MassEmailSignatureDto
{
    public string Html { get; set; } = "";
}

public class MassEmailAttachmentDto
{
    public int Id { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public DateTime CreatedDate { get; set; }
}
