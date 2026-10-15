namespace RotaryApi.DTOs;

public class CountryDto
{
    public int Id { get; set; }
    public string CountryName { get; set; } = "";
    public string CountryCode { get; set; } = "";
    public string PhoneCode { get; set; } = "";
    public string GmtOpt { get; set; } = "";
    public string GmtTime { get; set; } = "";
    public int Ordering { get; set; }
}
