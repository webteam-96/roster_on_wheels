namespace RotaryApi.DTOs;

public class RotaryYearDto
{
    public int Id { get; set; }
    public string YearLabel { get; set; } = "";
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public bool IsCurrent { get; set; }
}
