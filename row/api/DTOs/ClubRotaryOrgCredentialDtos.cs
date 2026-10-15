namespace RotaryApi.DTOs;

public class ClubRotaryOrgCredentialDto
{
    public bool HasCredentials { get; set; }
    public string? Username { get; set; }
    public string? Password { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

public class UpsertClubRotaryOrgCredentialDto
{
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
}
