namespace RotaryApi.DTOs;

// Category
public class OcvCategoryDto
{
    public int Id { get; set; }
    public string CategoryName { get; set; } = "";
    public string CategoryCode { get; set; } = "";
    public string? IconClass { get; set; }
    public int SortOrder { get; set; }
}

// Document type master
public class OcvDocumentTypeDto
{
    public int Id { get; set; }
    public int CategoryId { get; set; }
    public string TypeName { get; set; } = "";
    public bool AllowMultiple { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

// Create/Update document type (for settings)
public class CreateOcvDocumentTypeDto
{
    public int CategoryId { get; set; }
    public string TypeName { get; set; } = "";
    public bool AllowMultiple { get; set; }
    public int SortOrder { get; set; }
}

public class UpdateOcvDocumentTypeDto
{
    public string TypeName { get; set; } = "";
    public bool AllowMultiple { get; set; }
    public int SortOrder { get; set; }
}

// Document list item
public class OcvDocumentListItemDto
{
    public int Id { get; set; }
    public int TypeId { get; set; }
    public string TypeName { get; set; } = "";
    public string? CustomTypeName { get; set; }
    public string FileName { get; set; } = "";
    public string OriginalFileName { get; set; } = "";
    public string FilePath { get; set; } = "";
    public long FileSize { get; set; }
    public decimal? Amount { get; set; }
    public DateTime? PaidOn { get; set; }
    public DateTime CreatedDate { get; set; }
}

// Upload document request
public class UploadOcvDocumentDto
{
    public int YearId { get; set; }
    public int CategoryId { get; set; }
    public int TypeId { get; set; }
    public string? CustomTypeName { get; set; }
    public decimal? Amount { get; set; }
    public DateTime? PaidOn { get; set; }
}

// Update document request
public class UpdateOcvDocumentDto
{
    public int TypeId { get; set; }
    public string? CustomTypeName { get; set; }
    public decimal? Amount { get; set; }
    public DateTime? PaidOn { get; set; }
}

// OCV Report item (for Generate OCV Report page)
public class OcvReportItemDto
{
    public string CategoryName { get; set; } = "";
    public string CategoryCode { get; set; } = "";
    public int CategoryId { get; set; }
    public int TypeId { get; set; }
    public string TypeName { get; set; } = "";
    public bool IsUploaded { get; set; }
    public int? DocumentId { get; set; }
    public string? FilePath { get; set; }
    public string? OriginalFileName { get; set; }
}
