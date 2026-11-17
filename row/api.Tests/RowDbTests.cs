using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class RowDbTests
{
    // Set ROW_TEST_DB to a MySQL connection string to run this; without it the test returns early.
    private static readonly string? Db = Environment.GetEnvironmentVariable("ROW_TEST_DB");

    [Fact]
    public async Task Connect_RunsEverySessionInUtc_IncludingPooledReuse()
    {
        if (string.IsNullOrWhiteSpace(Db)) return;

        for (var i = 0; i < 2; i++) // the second open reuses the pooled connection, which MySQL resets
        {
            await using var conn = RowDb.Connect(Db);
            await conn.OpenAsync();
            await using var cmd = new MySqlCommand("SELECT @@session.time_zone, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW())", conn);
            await using var r = await cmd.ExecuteReaderAsync();
            Assert.True(await r.ReadAsync());
            Assert.Equal("+00:00", r.GetString(0));
            Assert.Equal(0, r.GetInt64(1));
        }
    }
}
