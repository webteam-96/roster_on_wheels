using System.Reflection;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// GET api/public/brand (master plan WS1-03): the non-secret part of the instance brand. The admin web app
/// and the mobile app read it first. Same JSON as the NestJS edition.
/// </summary>
[ApiController]
[Route("api/public/brand")]
[AllowAnonymous]
public class PublicBrandController : ControllerBase
{
    [HttpGet]
    [ResponseCache(Duration = 3600, Location = ResponseCacheLocation.Any)]
    public IActionResult Get() => Ok(Brand.PublicView());
}

/// <summary>
/// GET api/health (master plan WS0-01): status, version, commit, instance and whether the database answers.
/// Version and commit come from the deploy (BUILD_VERSION, BUILD_COMMIT). 503 when the database does not answer.
/// </summary>
[ApiController]
[Route("api/health")]
[AllowAnonymous]
public class HealthController : ControllerBase
{
    private static readonly string StartedAtUtc = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
    private readonly string _connectionString;

    public HealthController(IConfiguration config) => _connectionString = config.GetConnectionString("DefaultConnection") ?? "";

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var dbOk = false;
        try
        {
            await using var conn = new MySqlConnection(_connectionString);
            dbOk = await conn.ExecuteScalarAsync<int>("SELECT 1") == 1;
        }
        catch { dbOk = false; }
        var body = new
        {
            status = dbOk ? "ok" : "degraded",
            version = Environment.GetEnvironmentVariable("BUILD_VERSION")
                      ?? Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "dev",
            commit = Environment.GetEnvironmentVariable("BUILD_COMMIT") ?? "",
            instance = Brand.InstanceCode,
            dbOk,
            startedAtUtc = StartedAtUtc,
        };
        return dbOk ? Ok(body) : StatusCode(503, body);
    }
}
