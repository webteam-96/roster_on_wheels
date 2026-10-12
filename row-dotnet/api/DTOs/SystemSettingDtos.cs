namespace RotaryApi.DTOs;

public class SystemSettingDto
{
    public int Id { get; set; }
    public string SettingKey { get; set; } = "";
    public string SettingValue { get; set; } = "";
    public string? Description { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

public class UpsertSettingDto
{
    public string SettingKey { get; set; } = "";
    public string SettingValue { get; set; } = "";
    public string? Description { get; set; }
}
