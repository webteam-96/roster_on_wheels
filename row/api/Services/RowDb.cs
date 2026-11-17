using System.Collections.Concurrent;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// The one place ROW opens MySQL connections. Every session runs in UTC (<c>SET time_zone = '+00:00'</c>), so
/// NOW(), CURDATE(), column defaults and TIMESTAMP columns are UTC whatever zone the database server or the
/// app server runs in (production shares a MySQL server set to India time with other databases, so the
/// global setting cannot change). Also compiled into the workers (linked file).
/// </summary>
public static class RowDb
{
    private static readonly ConcurrentDictionary<string, MySqlDataSource> Sources = new();

    public static MySqlConnection Connect(string? connectionString) =>
        Sources.GetOrAdd(connectionString ?? "", Build).CreateConnection();

    private static MySqlDataSource Build(string connectionString) =>
        new MySqlDataSourceBuilder(connectionString)
            // A pooled connection is reset on reuse, which clears session variables, so set the zone on every open.
            .UseConnectionOpenedCallback(async (ctx, ct) =>
            {
                await using var cmd = ctx.Connection.CreateCommand();
                cmd.CommandText = "SET time_zone = '+00:00'";
                await cmd.ExecuteNonQueryAsync(ct);
            })
            .Build();
}
