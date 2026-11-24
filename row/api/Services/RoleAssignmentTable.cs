using System.Net;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>The role table of the "Your Role Assignment" email (Make Admin, for clubs and districts). One copy: the
/// two it replaces had drifted apart and left the member's club and the district number empty (ROW-66).</summary>
public static class RoleAssignmentTable
{
    public sealed record Role(int RoleId, string? ClubName, string? DistrictNumber);

    public static async Task<string> BuildAsync(MySqlConnection connection, int memberId)
    {
        // A Member row carries no club: the club is in club_members. A District Admin row has a district and no club.
        var roles = await connection.QueryAsync<Role>(@"
            SELECT r.fk_role_id AS RoleId, c.ClubName, d.DistrictNumber
            FROM member_roles r
            LEFT JOIN club_members cm ON r.fk_role_id = 1 AND cm.IsActive = 1 AND cm.isdeleted = 0
                AND cm.fk_member_master_profile_id = r.fk_member_master_profile_id
            LEFT JOIN club_master c ON c.pk_club_id = COALESCE(NULLIF(r.fk_club_id, 0), cm.fk_club_id)
            LEFT JOIN district_master d ON d.pk_district_id = COALESCE(NULLIF(r.fk_district_id, 0), c.fk_district_id)
            WHERE r.fk_member_master_profile_id = @memberId AND r.IsActive = 1 AND r.isdeleted = 0
            ORDER BY r.fk_role_id, c.ClubName", new { memberId });
        return Html(roles);
    }

    public static string Html(IEnumerable<Role> roles)
    {
        var html = "<table style='border-collapse: collapse; width: 100%; margin: 12px 0;'>"
            + "<tr style='background-color: #17458F; color: white;'>"
            + "<th style='padding: 8px 12px; text-align: left; border: 1px solid #D5DEE8;'>Role</th>"
            + "<th style='padding: 8px 12px; text-align: left; border: 1px solid #D5DEE8;'>Details</th>"
            + "</tr>";

        foreach (var r in roles)
        {
            var club = WebUtility.HtmlEncode(r.ClubName ?? "");
            var district = string.IsNullOrWhiteSpace(r.DistrictNumber) ? "" : $"District {WebUtility.HtmlEncode(r.DistrictNumber)}";
            var name = r.RoleId switch
            {
                2 => club == "" ? "District Admin" : "Club Admin",
                3 => "Super Admin",
                6 => "AG",
                _ => "Member",
            };
            var details = r.RoleId == 3
                ? "All Districts & Clubs"
                : string.Join(" - ", new[] { district, club }.Where(s => s != ""));
            if (details == "") continue; // a Member of no club: nothing to tell

            html += $"<tr><td style='padding: 8px 12px; border: 1px solid #D5DEE8; font-weight: bold;'>{name}</td>"
                  + $"<td style='padding: 8px 12px; border: 1px solid #D5DEE8;'>{details}</td></tr>";
        }

        return html + "</table>";
    }
}
