using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// District Awards (Citation) activation flag, per district + Rotary year. A SuperAdmin turns it
// ON/OFF. ON  → clubs can enter award points. OFF → clubs are read-only (point entry rejected).
// DEFAULT (no row) = DISABLED — a newly-set-up District Awards for a district+year starts OFF and a
// SuperAdmin must explicitly ENABLE it. Configuring categories/questions/criteria is always allowed
// (the flag only gates CLUB point entry), so admins can build the awards before it goes live.
public static class DistrictAwardsConfigHelper
{
    // True only when a row exists with is_enabled = 1. Missing row → DISABLED by default.
    public static async Task<bool> IsEnabledAsync(MySqlConnection conn, int districtId, int yearId)
    {
        var flag = await conn.ExecuteScalarAsync<int?>(
            @"SELECT is_enabled FROM district_awards_config
              WHERE fk_district_id = @D AND fk_year_id = @Y LIMIT 1",
            new { D = districtId, Y = yearId });
        return flag == 1;   // missing row → disabled by default
    }
}
