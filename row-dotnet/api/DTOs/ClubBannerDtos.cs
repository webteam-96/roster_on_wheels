namespace RotaryApi.DTOs;

public class ClubBannerDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string BannerImagePath { get; set; } = "";
    public string? DocumentPath { get; set; }
    public string? LinkUrl { get; set; }   // document OR link — both optional, mutually exclusive
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class CreateClubBannerDto
{
    public int YearId { get; set; }
    public string BannerImagePath { get; set; } = "";
    public string? DocumentPath { get; set; }
    public string? LinkUrl { get; set; }   // document OR link — both optional, mutually exclusive
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class UpdateClubBannerDto
{
    public string BannerImagePath { get; set; } = "";
    public string? DocumentPath { get; set; }
    public string? LinkUrl { get; set; }   // document OR link — both optional, mutually exclusive
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class ReorderBannersDto
{
    public int Id1 { get; set; }
    public int Id2 { get; set; }
}
