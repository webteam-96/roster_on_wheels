namespace RotaryApi.DTOs;

public class ClubAdvertisementDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string AdvertisementImagePath { get; set; } = "";
    public string? DocumentPath { get; set; }
    public string? LinkUrl { get; set; }   // external URL alternative to an uploaded document (mutually exclusive)
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class CreateClubAdvertisementDto
{
    public int YearId { get; set; }
    public string AdvertisementImagePath { get; set; } = "";
    public string? DocumentPath { get; set; }
    public string? LinkUrl { get; set; }   // external URL alternative to an uploaded document (mutually exclusive)
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class UpdateClubAdvertisementDto
{
    public string AdvertisementImagePath { get; set; } = "";
    public string? DocumentPath { get; set; }
    public string? LinkUrl { get; set; }   // external URL alternative to an uploaded document (mutually exclusive)
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class ReorderAdvertisementsDto
{
    public int Id1 { get; set; }
    public int Id2 { get; set; }
}
