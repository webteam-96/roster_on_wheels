using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/system-settings")]
[Authorize]
public class SystemSettingsController : ControllerBase
{
    private readonly ISystemSettingService _settingService;

    public SystemSettingsController(ISystemSettingService settingService)
    {
        _settingService = settingService;
    }

    [HttpGet("{key}")]
    public async Task<ActionResult> GetSetting(string key)
    {
        try
        {
            var setting = await _settingService.GetSettingAsync(key);
            return Ok(setting);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to get setting: {ex.Message}" });
        }
    }

    [HttpPost]
    public async Task<ActionResult> UpsertSetting([FromBody] UpsertSettingDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can modify settings." });

        try
        {
            await _settingService.UpsertSettingAsync(dto, GetCurrentMemberId());
            return Ok(new { message = "Setting saved successfully." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to save setting: {ex.Message}" });
        }
    }

    [HttpGet]
    public async Task<ActionResult> GetAllSettings()
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can view settings." });

        try
        {
            var settings = await _settingService.GetAllSettingsAsync();
            return Ok(settings);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to get settings: {ex.Message}" });
        }
    }

    private bool IsSuperAdmin()
    {
        return User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    }

    private int GetCurrentMemberId()
    {
        return int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    }
}
