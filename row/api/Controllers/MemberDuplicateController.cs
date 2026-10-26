using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

/// <summary>
/// SuperAdmin tool to find and resolve duplicate members that share a mobile / email.
///
/// Detection (validated against prod): a duplicate PAIR is a cross-slot match — one member holds a
/// value as PRIMARY, another holds the SAME value as SECONDARY (its own primary blank). This is exactly
/// what the daily sync produces when it parks a colliding mobile/email into the secondary slot because
/// PrimaryMobileNumber / EmailId are UNIQUE. Two members with different, real primaries are NOT flagged.
///
/// Two resolutions:
///   1. Merge  — true same-person duplicate: keep one, soft-delete the other, move its contact to the
///               survivor's secondary, transfer the loser's clubs + roles to the survivor.
///   2. Dismiss — legitimate shared contact (husband/wife): "keep both" records the pair in
///               member_dup_ignored so it never re-appears. The sync already preserves their values
///               (it never overwrites a populated primary), so this only silences the listing.
///
/// All endpoints are SuperAdmin-only. Every merge writes a before-state snapshot to bak_member_dup_merge.
/// Additive-only: new controller + two new tables; nothing existing is refactored.
/// </summary>
[ApiController]
[Authorize]
[Route("api/admin/member-duplicates")]
public class MemberDuplicateController : ControllerBase
{
    private readonly string _connectionString;
    private readonly ILogger<MemberDuplicateController> _logger;

    public MemberDuplicateController(IConfiguration config, ILogger<MemberDuplicateController> logger)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    // Idempotent — creates the two support tables the first time any endpoint runs, so the feature is
    // self-contained and doesn't depend on a DatabaseInitializer migration / API restart.
    private static async Task EnsureTablesAsync(MySqlConnection conn)
    {
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS member_dup_ignored (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                member_low_id INT NOT NULL,
                member_high_id INT NOT NULL,
                match_reason VARCHAR(40) NULL,
                note VARCHAR(500) NULL,
                created_by INT NULL,
                created_date DATETIME NOT NULL,
                UNIQUE KEY uq_dup_pair (member_low_id, member_high_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS bak_member_dup_merge (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                kept_member_id INT NOT NULL,
                deleted_member_id INT NOT NULL,
                snapshot LONGTEXT NULL,
                created_by INT NULL,
                created_date DATETIME NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
        // Free-text remark per duplicate pair (shown in the listing, one per canonical pair).
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS member_dup_remark (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                member_low_id INT NOT NULL,
                member_high_id INT NOT NULL,
                remark VARCHAR(1000) NULL,
                created_by INT NULL,
                created_date DATETIME NOT NULL,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                UNIQUE KEY uq_dup_remark_pair (member_low_id, member_high_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    }

    // The merged detection query. Returns one row per A-B pair with a matchTypes badge
    // ('Mobile' | 'Email' | 'Email+Mobile'). memberA = the parked side (blank primary), memberB = holder.
    private const string PairSql = @"
        SELECT x.memberA_id, x.memberB_id, x.ridA, x.ridB,
               MAX(CASE WHEN x.matchType='Mobile' THEN x.sharedValue END) AS sharedMobile,
               MAX(CASE WHEN x.matchType='Email'  THEN x.sharedValue END) AS sharedEmail,
               GROUP_CONCAT(DISTINCT x.matchType ORDER BY x.matchType SEPARATOR '+') AS matchTypes
        FROM (
            SELECT a.pk_member_master_profile_id AS memberA_id, b.pk_member_master_profile_id AS memberB_id,
                   a.RotaryId AS ridA, b.RotaryId AS ridB, b.PrimaryMobileNumber AS sharedValue, 'Mobile' AS matchType
            FROM member_master_profile a
            JOIN member_master_profile b
              ON TRIM(a.SecondaryMobileNumber) = TRIM(b.PrimaryMobileNumber)
             AND a.pk_member_master_profile_id <> b.pk_member_master_profile_id
            WHERE a.isdeleted = 0 AND b.isdeleted = 0
              AND TRIM(COALESCE(a.SecondaryMobileNumber,'')) <> ''
              AND TRIM(COALESCE(a.PrimaryMobileNumber,''))   =  ''
            UNION ALL
            SELECT a.pk_member_master_profile_id, b.pk_member_master_profile_id,
                   a.RotaryId, b.RotaryId, b.EmailId, 'Email'
            FROM member_master_profile a
            JOIN member_master_profile b
              ON TRIM(a.SecondaryEmailId) = TRIM(b.EmailId)
             AND a.pk_member_master_profile_id <> b.pk_member_master_profile_id
            WHERE a.isdeleted = 0 AND b.isdeleted = 0
              AND TRIM(COALESCE(a.SecondaryEmailId,'')) <> ''
              AND TRIM(COALESCE(a.EmailId,''))          =  ''
        ) x
        GROUP BY x.memberA_id, x.memberB_id, x.ridA, x.ridB";

    // Excludes pairs the SuperAdmin has dismissed ("keep both").
    private const string NotIgnored = @"
        NOT EXISTS (SELECT 1 FROM member_dup_ignored ig
                    WHERE ig.member_low_id  = LEAST(d.memberA_id, d.memberB_id)
                      AND ig.member_high_id = GREATEST(d.memberA_id, d.memberB_id))";

    // Inverse of NotIgnored — the "Kept Both (dismissed)" view shows ONLY pairs the SuperAdmin dismissed.
    private const string IsIgnored = @"
        EXISTS (SELECT 1 FROM member_dup_ignored ig
                WHERE ig.member_low_id  = LEAST(d.memberA_id, d.memberB_id)
                  AND ig.member_high_id = GREATEST(d.memberA_id, d.memberB_id))";

    private static string TypeFilter(string? type) => type?.ToLowerInvariant() switch
    {
        "mobile" => " AND d.matchTypes = 'Mobile' ",
        "email"  => " AND d.matchTypes = 'Email' ",
        "both"   => " AND d.matchTypes = 'Email+Mobile' ",
        _        => "",
    };

    // GET counts for the card + filter chips.
    [HttpGet("count")]
    public async Task<IActionResult> Count()
    {
        if (!IsSuperAdmin()) return Forbid();
        await using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);
        // NOTE: `both` is a MySQL reserved word — alias it as bothCount to avoid a syntax error.
        var row = await conn.QueryFirstAsync($@"
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(d.matchTypes='Mobile'),0)       AS mobile,
                   COALESCE(SUM(d.matchTypes='Email'),0)        AS email,
                   COALESCE(SUM(d.matchTypes='Email+Mobile'),0) AS bothCount
            FROM ({PairSql}) d
            WHERE {NotIgnored}");
        return Ok(new
        {
            total = (long)row.total,
            mobile = (long)row.mobile,
            email = (long)row.email,
            both = (long)row.bothCount,
        });
    }

    // GET paginated listing with names + a club label per side. Supports free-text search
    // and orders by member name ascending.
    //
    // Perf: PairSql's self-join (TRIM(...) equality → no index) is the expensive part and was
    // timing out once search added correlated LIKEs. So we materialise the (bounded) pair set
    // ONCE into a temp table — with every searchable value pre-computed — then count / search /
    // paginate over that small table. The heavy step runs a single time with a generous timeout.
    [HttpGet("list")]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        [FromQuery] string? type = null, [FromQuery] string? search = null, [FromQuery] bool dismissed = false)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (page < 1) page = 1;
        if (pageSize is < 1 or > 200) pageSize = 20;

        // dismissed=true → the "Kept Both" view (only pairs the SA dismissed); else the active list.
        var ignoreFilter = dismissed ? IsIgnored : NotIgnored;

        await using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);

        await conn.ExecuteAsync("DROP TEMPORARY TABLE IF EXISTS tmp_dup");
        await conn.ExecuteAsync($@"
            CREATE TEMPORARY TABLE tmp_dup AS
            SELECT d.memberA_id AS memberAId, d.memberB_id AS memberBId,
                   d.ridA, d.ridB, d.sharedMobile, d.sharedEmail, d.matchTypes,
                   ma.MemberName AS nameA, mb.MemberName AS nameB,
                   ma.PrimaryMobileNumber AS mobA, mb.PrimaryMobileNumber AS mobB,
                   ma.SecondaryMobileNumber AS smobA, mb.SecondaryMobileNumber AS smobB,
                   ma.EmailId AS emailA, mb.EmailId AS emailB,
                   ma.SecondaryEmailId AS semailA, mb.SecondaryEmailId AS semailB,
                   (SELECT c.ClubName FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                     WHERE cm.fk_member_master_profile_id = d.memberA_id AND cm.isdeleted = 0 AND cm.IsActive = 1
                     ORDER BY cm.pk_club_member_id LIMIT 1) AS clubA,
                   (SELECT c.ClubName FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                     WHERE cm.fk_member_master_profile_id = d.memberB_id AND cm.isdeleted = 0 AND cm.IsActive = 1
                     ORDER BY cm.pk_club_member_id LIMIT 1) AS clubB,
                   (SELECT GROUP_CONCAT(CONCAT_WS(' ', c.ClubName, dm.DistrictNumber) SEPARATOR ' | ')
                     FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                     LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
                     WHERE cm.fk_member_master_profile_id = d.memberA_id AND cm.isdeleted = 0) AS clubsSearchA,
                   (SELECT GROUP_CONCAT(CONCAT_WS(' ', c.ClubName, dm.DistrictNumber) SEPARATOR ' | ')
                     FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                     LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
                     WHERE cm.fk_member_master_profile_id = d.memberB_id AND cm.isdeleted = 0) AS clubsSearchB,
                   (SELECT r.remark FROM member_dup_remark r
                     WHERE r.member_low_id  = LEAST(d.memberA_id, d.memberB_id)
                       AND r.member_high_id = GREATEST(d.memberA_id, d.memberB_id)) AS remark
            FROM ({PairSql}) d
            JOIN member_master_profile ma ON ma.pk_member_master_profile_id = d.memberA_id
            JOIN member_master_profile mb ON mb.pk_member_master_profile_id = d.memberB_id
            WHERE {ignoreFilter}", commandTimeout: 240);

        var typeSql = type?.ToLowerInvariant() switch
        {
            "mobile" => " AND matchTypes = 'Mobile' ",
            "email"  => " AND matchTypes = 'Email' ",
            "both"   => " AND matchTypes = 'Email+Mobile' ",
            _        => "",
        };
        var q = (search ?? "").Trim();
        var searchSql = q.Length > 0 ? @"
            AND (nameA LIKE @Q OR nameB LIKE @Q OR ridA LIKE @Q OR ridB LIKE @Q
                 OR sharedMobile LIKE @Q OR sharedEmail LIKE @Q
                 OR mobA LIKE @Q OR mobB LIKE @Q OR smobA LIKE @Q OR smobB LIKE @Q
                 OR emailA LIKE @Q OR emailB LIKE @Q OR semailA LIKE @Q OR semailB LIKE @Q
                 OR clubsSearchA LIKE @Q OR clubsSearchB LIKE @Q OR remark LIKE @Q)" : "";
        var args = new { Take = pageSize, Skip = (page - 1) * pageSize, Q = $"%{q}%" };

        var total = await conn.ExecuteScalarAsync<long>(
            $"SELECT COUNT(*) FROM tmp_dup WHERE 1=1 {typeSql} {searchSql}", args);

        var items = await conn.QueryAsync($@"
            SELECT memberAId, memberBId, ridA, ridB, sharedMobile, sharedEmail, matchTypes,
                   nameA, nameB, clubA, clubB, remark
            FROM tmp_dup WHERE 1=1 {typeSql} {searchSql}
            ORDER BY nameA ASC, memberAId
            LIMIT @Take OFFSET @Skip", args);

        return Ok(new { total, page, pageSize, items });
    }

    // GET both members' full profile + clubs + roles for the merge popup.
    [HttpGet("pair")]
    public async Task<IActionResult> Pair([FromQuery] int aId, [FromQuery] int bId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (aId <= 0 || bId <= 0 || aId == bId) return BadRequest(new { message = "Two distinct member ids required." });

        await using var conn = CreateConnection();
        await conn.OpenAsync();

        var memberA = await LoadProfileAsync(conn, aId);
        var memberB = await LoadProfileAsync(conn, bId);
        if (memberA == null || memberB == null) return NotFound(new { message = "One or both members not found." });

        return Ok(new
        {
            memberA,
            memberB,
            clubsA = await LoadClubsAsync(conn, aId),
            clubsB = await LoadClubsAsync(conn, bId),
            rolesA = await LoadRolesAsync(conn, aId),
            rolesB = await LoadRolesAsync(conn, bId),
            familyA = await LoadFamilyAsync(conn, aId),
            familyB = await LoadFamilyAsync(conn, bId),
        });
    }

    private static async Task<dynamic?> LoadProfileAsync(MySqlConnection conn, int id) =>
        await conn.QueryFirstOrDefaultAsync(@"
            SELECT pk_member_master_profile_id AS id, MemberName AS memberName, RotaryId AS rotaryId,
                   EmailId AS emailId, SecondaryEmailId AS secondaryEmailId,
                   PrimaryMobileNumber AS primaryMobileNumber, SecondaryMobileNumber AS secondaryMobileNumber,
                   fk_primary_country_id AS fkPrimaryCountryId, fk_secondary_country_id AS fkSecondaryCountryId,
                   BirthDate AS birthDate, AnniversaryDate AS anniversaryDate, BloodGroup AS bloodGroup,
                   Gender AS gender, PrimaryLanguage AS primaryLanguage, IsYouth AS isYouth,
                   MemberIntroduction AS memberIntroduction, DonorRecognition AS donorRecognition,
                   Facebook AS facebook, Instagram AS instagram, LinkedIn AS linkedIn, Twitter AS twitter,
                   Youtube AS youtube, Website AS website, ProfilePhotoPath AS profilePhotoPath,
                   created_date AS createdDate
            FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = id });

    private static async Task<IEnumerable<dynamic>> LoadClubsAsync(MySqlConnection conn, int id) =>
        await conn.QueryAsync(@"
            SELECT cm.pk_club_member_id AS clubMemberId, cm.fk_club_id AS fkClubId, c.ClubName AS clubName,
                   dm.DistrictNumber AS districtNumber, cm.Designation AS designation,
                   cm.IsHonoraryMember AS isHonorary, cm.JoinedDate AS joinedDate
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
            WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0 AND cm.IsActive = 1
            ORDER BY c.ClubName", new { Id = id });

    private static async Task<IEnumerable<dynamic>> LoadFamilyAsync(MySqlConnection conn, int id) =>
        await conn.QueryAsync(@"
            SELECT pk_member_family_details_id AS familyId, Name AS name, Relation AS relation,
                   PhoneNumber AS phoneNumber, EmailId AS emailId, BirthDate AS birthDate,
                   AnniversaryDate AS anniversaryDate, BloodGroup AS bloodGroup
            FROM member_family_details
            WHERE fk_member_master_profile_id = @Id AND isdeleted = 0
            ORDER BY pk_member_family_details_id", new { Id = id });

    // All roles from the 4 sources, flattened. Nothing is missed: system roles, BOD, DC, GDC, SGDC, DG.
    private static async Task<IEnumerable<dynamic>> LoadRolesAsync(MySqlConnection conn, int id)
    {
        var sql = @"
            -- system roles
            SELECT 'System' AS source, r.RoleName AS label, c.ClubName AS context, NULL AS year
            FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            LEFT JOIN club_master c ON c.pk_club_id = mr.fk_club_id
            WHERE mr.fk_member_master_profile_id = @Id AND mr.isdeleted = 0 AND mr.IsActive = 1
            UNION ALL
            -- BOD
            SELECT 'BOD', COALESCE(dg.designation_name, bod.custom_designation, 'Board Member'),
                   c.ClubName, y.YearLabel
            FROM board_of_directors bod
            LEFT JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
            LEFT JOIN club_master c ON c.pk_club_id = bod.fk_club_id
            LEFT JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
            WHERE bod.fk_member_master_profile_id = @Id AND bod.isdeleted = 0
            UNION ALL
            -- District Committee (DC)
            SELECT 'DC', dcm.district_designation, dcm.club_name, y.YearLabel
            FROM district_committee_member dcm
            LEFT JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
            WHERE dcm.fk_member_id = @Id AND dcm.isdeleted = 0 AND dcm.is_active = 1
            UNION ALL
            -- District Committee Group (GDC)
            SELECT 'GDC', CONCAT(COALESCE(g.group_name,''), ' — ', COALESCE(gm.district_designation,'')),
                   gm.club_name, y.YearLabel
            FROM district_committee_group_member gm
            JOIN district_committee_group g ON g.id = gm.fk_group_id
            LEFT JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
            WHERE gm.fk_member_id = @Id AND gm.isdeleted = 0 AND gm.is_active = 1
            UNION ALL
            -- District Committee Sub-Group (SGDC)
            SELECT 'SGDC', CONCAT(COALESCE(sg.sub_group_name,''), ' — ', COALESCE(sgm.district_designation,'')),
                   sgm.club_name, NULL
            FROM district_committee_sub_group_member sgm
            JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id
            WHERE sgm.fk_member_id = @Id AND sgm.isdeleted = 0 AND sgm.is_active = 1
            UNION ALL
            -- District Governor (DG)
            SELECT 'DG', COALESCE(dgv.description, 'District Governor'),
                   dm.DistrictNumber, y.YearLabel
            FROM district_governors dgv
            LEFT JOIN district_master dm ON dm.pk_district_id = dgv.fk_district_id
            LEFT JOIN rotary_year_master y ON y.pk_year_id = dgv.fk_year_id
            WHERE dgv.fk_member_id = @Id AND dgv.isdeleted = 0";
        return await conn.QueryAsync(sql, new { Id = id });
    }

    public class SurvivorClub { public int FkClubId { get; set; } public bool IsHonorary { get; set; } public string? JoinedDate { get; set; } }
    public class ResolveRequest
    {
        public int KeepId { get; set; }
        public int DeleteId { get; set; }
        public Dictionary<string, JsonElement>? Survivor { get; set; }
        public List<SurvivorClub>? Clubs { get; set; }
    }

    // Whitelist: frontend field name -> DB column. Only these are updatable on the survivor.
    private static readonly Dictionary<string, string> UpdatableColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["rotaryId"] = "RotaryId",   // survivor may take the loser's RID (shift); loser's RID is freed first
        ["memberName"] = "MemberName",
        ["emailId"] = "EmailId",
        ["secondaryEmailId"] = "SecondaryEmailId",
        ["primaryMobileNumber"] = "PrimaryMobileNumber",
        ["secondaryMobileNumber"] = "SecondaryMobileNumber",
        ["birthDate"] = "BirthDate",
        ["anniversaryDate"] = "AnniversaryDate",
        ["bloodGroup"] = "BloodGroup",
        ["gender"] = "Gender",
        ["primaryLanguage"] = "PrimaryLanguage",
        ["memberIntroduction"] = "MemberIntroduction",
        ["donorRecognition"] = "DonorRecognition",
        ["facebook"] = "Facebook",
        ["instagram"] = "Instagram",
        ["linkedIn"] = "LinkedIn",
        ["twitter"] = "Twitter",
        ["youtube"] = "Youtube",
        ["website"] = "Website",
        ["fkPrimaryCountryId"] = "fk_primary_country_id",
        ["fkSecondaryCountryId"] = "fk_secondary_country_id",
    };

    private static object? ToDbValue(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.String => string.IsNullOrWhiteSpace(el.GetString()) ? null : el.GetString(),
        JsonValueKind.Number => el.TryGetInt64(out var l) ? l : el.GetDouble(),
        JsonValueKind.True => 1,
        JsonValueKind.False => 0,
        _ => null,
    };

    // POST merge: keep one member, soft-delete the other, move contact to survivor's secondary,
    // transfer clubs + roles. All in one transaction; a before-state snapshot is written first.
    [HttpPost("resolve")]
    public async Task<IActionResult> Resolve([FromBody] ResolveRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.KeepId <= 0 || req.DeleteId <= 0 || req.KeepId == req.DeleteId)
            return BadRequest(new { message = "keepId and deleteId must be two distinct members." });

        var userId = GetUserId();
        await using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);

        // All reads via the (transaction-less) helpers happen BEFORE the transaction opens —
        // MySqlConnector rejects a command that runs while a transaction is active but not attached to it.
        var keepProfile = await LoadProfileAsync(conn, req.KeepId);
        var loserProfile = await LoadProfileAsync(conn, req.DeleteId);
        if (keepProfile == null || loserProfile == null)
            return NotFound(new { message = "Member not found (already merged?)." });

        string? loserMob = loserProfile.primaryMobileNumber;
        string? loserEmail = loserProfile.emailId;
        var snapshot = JsonSerializer.Serialize(new
        {
            keep = keepProfile,
            delete = loserProfile,
            keepClubs = await LoadClubsAsync(conn, req.KeepId),
            deleteClubs = await LoadClubsAsync(conn, req.DeleteId),
            keepRoles = await LoadRolesAsync(conn, req.KeepId),
            deleteRoles = await LoadRolesAsync(conn, req.DeleteId),
            keepFamily = await LoadFamilyAsync(conn, req.KeepId),
            deleteFamily = await LoadFamilyAsync(conn, req.DeleteId),
        });

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
            // 1. Save the before-state snapshot for recovery.
            await conn.ExecuteAsync(@"INSERT INTO bak_member_dup_merge (kept_member_id, deleted_member_id, snapshot, created_by, created_date)
                                     VALUES (@Keep, @Del, @Snap, @By, NOW())",
                new { Keep = req.KeepId, Del = req.DeleteId, Snap = snapshot, By = userId }, tx);

            // 2. Free ONLY the loser's primary mobile + email (these move to the survivor's secondary
            //    below). Everything else on the loser is left untouched — in particular its RotaryId and
            //    its secondary mobile/email are NEVER nulled. RotaryId is only freed further down, and
            //    only when the survivor is explicitly taking it (a RID shift).
            await conn.ExecuteAsync(@"UPDATE member_master_profile
                SET PrimaryMobileNumber = NULL, EmailId = NULL, modified_by = @By, modified_date = NOW()
                WHERE pk_member_master_profile_id = @Id", new { Id = req.DeleteId, By = userId }, tx);

            // Only free the loser's RotaryId if the survivor's edited RID equals the loser's original RID
            // (i.e. the SA shifted the RID). Otherwise the loser keeps its own Rotary ID intact.
            var survivorTakesLoserRid = req.Survivor != null
                && req.Survivor.TryGetValue("rotaryId", out var ridEl)
                && ToDbValue(ridEl) is string survRid && !string.IsNullOrWhiteSpace(survRid)
                && string.Equals(survRid, (string?)loserProfile.rotaryId, StringComparison.OrdinalIgnoreCase);
            if (survivorTakesLoserRid)
                await conn.ExecuteAsync("UPDATE member_master_profile SET RotaryId = NULL WHERE pk_member_master_profile_id = @Id",
                    new { Id = req.DeleteId }, tx);

            // 3. Apply the survivor's edited field values (from the popup's kept column).
            if (req.Survivor is { Count: > 0 })
            {
                var sets = new List<string>();
                var pars = new DynamicParameters();
                pars.Add("Id", req.KeepId);
                pars.Add("By", userId);
                foreach (var kv in req.Survivor)
                {
                    if (!UpdatableColumns.TryGetValue(kv.Key, out var col)) continue;
                    var p = "p_" + col;
                    sets.Add($"{col} = @{p}");
                    pars.Add(p, ToDbValue(kv.Value));
                }
                if (sets.Count > 0)
                {
                    sets.Add("modified_by = @By");
                    sets.Add("modified_date = NOW()");
                    await conn.ExecuteAsync($"UPDATE member_master_profile SET {string.Join(", ", sets)} WHERE pk_member_master_profile_id = @Id", pars, tx);
                }
            }

            // 4. Preserve the loser's contact on the survivor's SECONDARY slots (only when blank & distinct).
            var survivorNow = await conn.QueryFirstAsync(
                "SELECT PrimaryMobileNumber AS pmob, SecondaryMobileNumber AS smob, EmailId AS pemail, SecondaryEmailId AS semail FROM member_master_profile WHERE pk_member_master_profile_id=@Id",
                new { Id = req.KeepId }, tx);
            if (!string.IsNullOrWhiteSpace(loserMob)
                && string.IsNullOrWhiteSpace((string?)survivorNow.smob)
                && !string.Equals((string?)survivorNow.pmob, loserMob, StringComparison.Ordinal))
                await conn.ExecuteAsync("UPDATE member_master_profile SET SecondaryMobileNumber=@V, modified_date=NOW() WHERE pk_member_master_profile_id=@Id",
                    new { V = loserMob, Id = req.KeepId }, tx);
            if (!string.IsNullOrWhiteSpace(loserEmail)
                && string.IsNullOrWhiteSpace((string?)survivorNow.semail)
                && !string.Equals((string?)survivorNow.pemail, loserEmail, StringComparison.OrdinalIgnoreCase))
                await conn.ExecuteAsync("UPDATE member_master_profile SET SecondaryEmailId=@V, modified_date=NOW() WHERE pk_member_master_profile_id=@Id",
                    new { V = loserEmail, Id = req.KeepId }, tx);

            // 5. Soft-delete the loser's profile (never hard-delete).
            await conn.ExecuteAsync(@"UPDATE member_master_profile
                SET isdeleted = 1, deleted_by = @By, deleted_date = NOW() WHERE pk_member_master_profile_id = @Id",
                new { Id = req.DeleteId, By = userId }, tx);

            // 6. Apply the curated club set to the survivor (union the popup collected from both columns).
            await ApplyClubsAsync(conn, tx, req.KeepId, req.Clubs ?? new(), userId);
            // Soft-delete the loser's club links (its memberships are replaced by the survivor's curated set).
            await conn.ExecuteAsync(@"UPDATE club_members SET isdeleted = 1, IsActive = 0, deleted_by = @By, deleted_date = NOW()
                                     WHERE fk_member_master_profile_id = @Id AND isdeleted = 0",
                new { Id = req.DeleteId, By = userId }, tx);

            // 7. Transfer the loser's roles to the survivor so nothing is lost (re-point active rows).
            await conn.ExecuteAsync("UPDATE member_roles SET fk_member_master_profile_id=@Keep, modified_date=NOW() WHERE fk_member_master_profile_id=@Del AND isdeleted=0", new { Keep = req.KeepId, Del = req.DeleteId }, tx);
            await conn.ExecuteAsync("UPDATE board_of_directors SET fk_member_master_profile_id=@Keep, modified_date=NOW() WHERE fk_member_master_profile_id=@Del AND isdeleted=0", new { Keep = req.KeepId, Del = req.DeleteId }, tx);
            await conn.ExecuteAsync("UPDATE district_committee_member SET fk_member_id=@Keep, modified_date=NOW() WHERE fk_member_id=@Del AND isdeleted=0", new { Keep = req.KeepId, Del = req.DeleteId }, tx);
            await conn.ExecuteAsync("UPDATE district_committee_group_member SET fk_member_id=@Keep, modified_date=NOW() WHERE fk_member_id=@Del AND isdeleted=0", new { Keep = req.KeepId, Del = req.DeleteId }, tx);
            // The re-point can leave the survivor twice in the same Club Presidents / Secretaries group for the
            // same club (both profiles were listed): keep one row (oldest). Manual DC groups are untouched.
            await conn.ExecuteAsync(@"
                UPDATE district_committee_group_member t
                JOIN (
                    SELECT MIN(m.id) AS keep_id, m.fk_group_id, m.fk_club_id
                    FROM district_committee_group_member m
                    JOIN district_committee_group g ON g.id = m.fk_group_id AND g.isdeleted = 0
                     AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
                       OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')
                    WHERE m.fk_member_id = @Keep AND m.isdeleted = 0
                    GROUP BY m.fk_group_id, m.fk_club_id
                    HAVING COUNT(*) > 1
                ) dup ON dup.fk_group_id = t.fk_group_id AND dup.fk_club_id = t.fk_club_id
                SET t.isdeleted = 1, t.modified_date = NOW()
                WHERE t.fk_member_id = @Keep AND t.isdeleted = 0 AND t.id <> dup.keep_id", new { Keep = req.KeepId }, tx);
            await conn.ExecuteAsync("UPDATE district_committee_sub_group_member SET fk_member_id=@Keep, modified_date=NOW() WHERE fk_member_id=@Del AND isdeleted=0", new { Keep = req.KeepId, Del = req.DeleteId }, tx);
            await conn.ExecuteAsync("UPDATE district_governors SET fk_member_id=@Keep, modified_date=NOW() WHERE fk_member_id=@Del AND isdeleted=0", new { Keep = req.KeepId, Del = req.DeleteId }, tx);
            // Transfer the loser's family members to the survivor so nothing is lost (re-point active rows).
            await conn.ExecuteAsync("UPDATE member_family_details SET fk_member_master_profile_id=@Keep, modified_date=NOW() WHERE fk_member_master_profile_id=@Del AND isdeleted=0", new { Keep = req.KeepId, Del = req.DeleteId }, tx);
            // One spouse per member: when both profiles had a spouse, keep only the latest-changed one
            // (the same row the Directory uses). Soft delete; undo restores it.
            await conn.ExecuteAsync(@"
                UPDATE member_family_details f
                JOIN (
                    SELECT pk_member_family_details_id AS pk_id,
                           ROW_NUMBER() OVER (ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC) AS rn
                    FROM member_family_details
                    WHERE fk_member_master_profile_id = @Keep AND LOWER(TRIM(Relation)) = 'spouse' AND COALESCE(isdeleted,0) = 0
                ) x ON x.pk_id = f.pk_member_family_details_id AND x.rn > 1
                SET f.isdeleted = 1, f.deleted_date = NOW()", new { Keep = req.KeepId }, tx);

            // 8. De-dup identical system roles that the transfer may have created (same role + club on survivor).
            await conn.ExecuteAsync(@"
                UPDATE member_roles t
                JOIN (
                    SELECT MIN(pk_member_role_id) AS keep_pk, fk_member_master_profile_id, fk_role_id, COALESCE(fk_club_id,0) AS club
                    FROM member_roles
                    WHERE fk_member_master_profile_id = @Keep AND isdeleted = 0
                    GROUP BY fk_member_master_profile_id, fk_role_id, COALESCE(fk_club_id,0)
                    HAVING COUNT(*) > 1
                ) dup ON dup.fk_member_master_profile_id = t.fk_member_master_profile_id
                    AND dup.fk_role_id = t.fk_role_id AND dup.club = COALESCE(t.fk_club_id,0)
                SET t.isdeleted = 1, t.modified_date = NOW()
                WHERE t.pk_member_role_id <> dup.keep_pk AND t.isdeleted = 0", new { Keep = req.KeepId }, tx);

            await tx.CommitAsync();
            _logger.LogInformation("Member merge: kept {Keep}, deleted {Del} by user {User}.", req.KeepId, req.DeleteId, userId);
            return Ok(new { success = true, keptId = req.KeepId, deletedId = req.DeleteId });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            _logger.LogError(ex, "Member merge failed (keep {Keep}, delete {Del}).", req.KeepId, req.DeleteId);
            return StatusCode(500, new { message = "Merge failed and was rolled back." });
        }
    }

    private static async Task ApplyClubsAsync(MySqlConnection conn, MySqlTransaction tx, int memberId, List<SurvivorClub> clubs, int userId)
    {
        var keepClubIds = clubs.Select(c => c.FkClubId).Distinct().ToList();

        // Soft-delete the survivor's active club links that are NOT in the curated set.
        if (keepClubIds.Count > 0)
            await conn.ExecuteAsync(@"UPDATE club_members SET isdeleted=1, IsActive=0, deleted_by=@By, deleted_date=NOW()
                                     WHERE fk_member_master_profile_id=@Id AND isdeleted=0 AND fk_club_id NOT IN @Clubs",
                new { Id = memberId, By = userId, Clubs = keepClubIds }, tx);
        else
            await conn.ExecuteAsync(@"UPDATE club_members SET isdeleted=1, IsActive=0, deleted_by=@By, deleted_date=NOW()
                                     WHERE fk_member_master_profile_id=@Id AND isdeleted=0",
                new { Id = memberId, By = userId }, tx);

        // Upsert each curated club: reactivate a soft-deleted link, update honorary, or insert fresh.
        foreach (var c in clubs)
        {
            var existing = await conn.QueryFirstOrDefaultAsync<int?>(
                "SELECT pk_club_member_id FROM club_members WHERE fk_member_master_profile_id=@Id AND fk_club_id=@Club ORDER BY isdeleted, pk_club_member_id LIMIT 1",
                new { Id = memberId, Club = c.FkClubId }, tx);
            // JoinedDate: the SA can correct it in the popup. COALESCE keeps the existing value when blank.
            var joined = string.IsNullOrWhiteSpace(c.JoinedDate) ? null : c.JoinedDate;
            if (existing.HasValue)
                await conn.ExecuteAsync(@"UPDATE club_members
                    SET isdeleted=0, IsActive=1, IsHonoraryMember=@Hon, JoinedDate=COALESCE(@Joined, JoinedDate),
                        deleted_by=NULL, deleted_date=NULL, modified_by=@By, modified_date=NOW()
                    WHERE pk_club_member_id=@Pk", new { Pk = existing.Value, Hon = c.IsHonorary ? 1 : 0, Joined = joined, By = userId }, tx);
            else
                await conn.ExecuteAsync(@"INSERT INTO club_members
                    (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, IsHonoraryMember, created_by, created_date, isdeleted)
                    VALUES (@Club, @Id, COALESCE(@Joined, CURDATE()), 1, @Hon, @By, NOW(), 0)",
                    new { Club = c.FkClubId, Id = memberId, Hon = c.IsHonorary ? 1 : 0, Joined = joined, By = userId }, tx);
        }
    }

    // POST dismiss ("keep both" — legitimate shared contact like husband/wife). Records the pair so it
    // never re-appears. Optionally SAVES per-member field edits: EditsA → member A, EditsB → member B.
    // Each member's edits go to its OWN row only — the two records are updated INDEPENDENTLY, never
    // merged/mixed (e.g. fill in the spouse's blank primary mobile without touching the other member).
    public class DismissRequest
    {
        public int MemberAId { get; set; }
        public int MemberBId { get; set; }
        public string? Reason { get; set; }
        public string? Note { get; set; }
        public Dictionary<string, JsonElement>? EditsA { get; set; }
        public Dictionary<string, JsonElement>? EditsB { get; set; }
    }

    public class RemarkRequest
    {
        public int MemberAId { get; set; }
        public int MemberBId { get; set; }
        public string? Remark { get; set; }
    }

    // Add / edit / clear the free-text remark for a duplicate pair. Upsert on the canonical
    // (low, high) pair so it survives regardless of which side is A or B. A blank remark clears it.
    [HttpPost("remark")]
    public async Task<IActionResult> SaveRemark([FromBody] RemarkRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.MemberAId <= 0 || req.MemberBId <= 0 || req.MemberAId == req.MemberBId)
            return BadRequest(new { message = "Two distinct member ids required." });

        var low = Math.Min(req.MemberAId, req.MemberBId);
        var high = Math.Max(req.MemberAId, req.MemberBId);
        var by = GetUserId();
        var remark = string.IsNullOrWhiteSpace(req.Remark) ? null : req.Remark.Trim();

        await using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);

        if (remark == null)
        {
            await conn.ExecuteAsync(
                "DELETE FROM member_dup_remark WHERE member_low_id = @Low AND member_high_id = @High",
                new { Low = low, High = high });
            return Ok(new { success = true, remark = (string?)null });
        }

        await conn.ExecuteAsync(@"
            INSERT INTO member_dup_remark (member_low_id, member_high_id, remark, created_by, created_date)
            VALUES (@Low, @High, @Remark, @By, NOW())
            ON DUPLICATE KEY UPDATE remark = VALUES(remark), modified_by = @By, modified_date = NOW();",
            new { Low = low, High = high, Remark = remark, By = by });

        return Ok(new { success = true, remark });
    }

    // Contact fields that may carry a UNIQUE index / dedup — freed to NULL before reassigning so a
    // legitimate swap between the two members (e.g. moving a mobile from the wife to the husband)
    // doesn't transiently collide. A genuine duplicate (same value ending on both, or clashing with a
    // THIRD member) still surfaces as a DB error.
    private static readonly HashSet<string> UniqueContactKeys = new(StringComparer.OrdinalIgnoreCase)
    { "primaryMobileNumber", "secondaryMobileNumber", "emailId", "secondaryEmailId" };

    private static async Task FreeChangedUniqueFieldsAsync(MySqlConnection conn, MySqlTransaction tx, int memberId, Dictionary<string, JsonElement>? edits, int by)
    {
        if (memberId <= 0 || edits == null || edits.Count == 0) return;
        var sets = new List<string>();
        foreach (var kv in edits)
        {
            if (!UniqueContactKeys.Contains(kv.Key)) continue;
            if (!UpdatableColumns.TryGetValue(kv.Key, out var col)) continue;
            sets.Add($"{col} = NULL");
        }
        if (sets.Count == 0) return;
        await conn.ExecuteAsync($"UPDATE member_master_profile SET {string.Join(", ", sets)} WHERE pk_member_master_profile_id = @Id",
            new { Id = memberId }, tx);
    }

    // Applies whitelisted field edits to ONE member's profile. rotaryId is excluded — in "keep both"
    // each member is a distinct person that keeps its own Rotary ID (never swapped between the two).
    private static async Task ApplyMemberEditsAsync(MySqlConnection conn, MySqlTransaction tx, int memberId, Dictionary<string, JsonElement>? edits, int by)
    {
        if (memberId <= 0 || edits == null || edits.Count == 0) return;
        var sets = new List<string>();
        var pars = new DynamicParameters();
        pars.Add("Id", memberId);
        pars.Add("By", by);
        foreach (var kv in edits)
        {
            if (string.Equals(kv.Key, "rotaryId", StringComparison.OrdinalIgnoreCase)) continue;
            if (!UpdatableColumns.TryGetValue(kv.Key, out var col)) continue;
            var p = "p_" + col;
            sets.Add($"{col} = @{p}");
            pars.Add(p, ToDbValue(kv.Value));
        }
        if (sets.Count == 0) return;
        sets.Add("modified_by = @By");
        sets.Add("modified_date = NOW()");
        await conn.ExecuteAsync($"UPDATE member_master_profile SET {string.Join(", ", sets)} WHERE pk_member_master_profile_id = @Id", pars, tx);
    }

    [HttpPost("dismiss")]
    public async Task<IActionResult> Dismiss([FromBody] DismissRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.MemberAId <= 0 || req.MemberBId <= 0 || req.MemberAId == req.MemberBId)
            return BadRequest(new { message = "Two distinct member ids required." });

        var low = Math.Min(req.MemberAId, req.MemberBId);
        var high = Math.Max(req.MemberAId, req.MemberBId);
        var by = GetUserId();
        await using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
            // Save each member's own edits to its OWN row — independent, never merged.
            // Free changed unique contact fields on BOTH first, so a swap/reassign between the two
            // (e.g. the wife's mobile moving to the husband) doesn't transiently trip a unique index.
            await FreeChangedUniqueFieldsAsync(conn, tx, req.MemberAId, req.EditsA, by);
            await FreeChangedUniqueFieldsAsync(conn, tx, req.MemberBId, req.EditsB, by);
            await ApplyMemberEditsAsync(conn, tx, req.MemberAId, req.EditsA, by);
            await ApplyMemberEditsAsync(conn, tx, req.MemberBId, req.EditsB, by);

            await conn.ExecuteAsync(@"INSERT INTO member_dup_ignored (member_low_id, member_high_id, match_reason, note, created_by, created_date)
                                     VALUES (@Low, @High, @Reason, @Note, @By, NOW())
                                     ON DUPLICATE KEY UPDATE match_reason=VALUES(match_reason), note=VALUES(note), created_by=VALUES(created_by), created_date=NOW()",
                new { Low = low, High = high, Reason = req.Reason, Note = req.Note, By = by }, tx);
            await tx.CommitAsync();
        }
        catch (Exception)
        {
            await tx.RollbackAsync();
            return StatusCode(500, new { message = "Could not save & keep both records." });
        }
        return Ok(new { success = true });
    }

    // POST un-dismiss — re-open a "Kept Both" pair so it appears in the active duplicates list again.
    public class UndismissRequest { public int MemberAId { get; set; } public int MemberBId { get; set; } }

    [HttpPost("undismiss")]
    public async Task<IActionResult> Undismiss([FromBody] UndismissRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.MemberAId <= 0 || req.MemberBId <= 0 || req.MemberAId == req.MemberBId)
            return BadRequest(new { message = "Two distinct member ids required." });
        var low = Math.Min(req.MemberAId, req.MemberBId);
        var high = Math.Max(req.MemberAId, req.MemberBId);
        await using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);
        await conn.ExecuteAsync(
            "DELETE FROM member_dup_ignored WHERE member_low_id = @Low AND member_high_id = @High",
            new { Low = low, High = high });
        return Ok(new { success = true });
    }

    // ── Undo a merge (Revert) ────────────────────────────────────────────────
    // Every merge saved a full before-state snapshot to bak_member_dup_merge. This restores both
    // members from that snapshot: reactivates the deleted member and puts back BOTH profiles, and
    // (by primary key) their club links and family rows. Roles are stored descriptively in the
    // snapshot (no ids), so they are NOT auto-restored — the response flags that when the deleted
    // member had roles, so the SA can re-check them.
    private static readonly Dictionary<string, string> ProfileRestoreColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["memberName"] = "MemberName", ["rotaryId"] = "RotaryId", ["emailId"] = "EmailId", ["secondaryEmailId"] = "SecondaryEmailId",
        ["primaryMobileNumber"] = "PrimaryMobileNumber", ["secondaryMobileNumber"] = "SecondaryMobileNumber",
        ["fkPrimaryCountryId"] = "fk_primary_country_id", ["fkSecondaryCountryId"] = "fk_secondary_country_id",
        ["birthDate"] = "BirthDate", ["anniversaryDate"] = "AnniversaryDate", ["bloodGroup"] = "BloodGroup",
        ["gender"] = "Gender", ["primaryLanguage"] = "PrimaryLanguage", ["isYouth"] = "IsYouth",
        ["memberIntroduction"] = "MemberIntroduction", ["donorRecognition"] = "DonorRecognition",
        ["facebook"] = "Facebook", ["instagram"] = "Instagram", ["linkedIn"] = "LinkedIn", ["twitter"] = "Twitter",
        ["youtube"] = "Youtube", ["website"] = "Website", ["profilePhotoPath"] = "ProfilePhotoPath",
    };

    private static List<int> PksFromArray(JsonElement root, string prop, string idKey)
    {
        var ids = new List<int>();
        if (root.TryGetProperty(prop, out var arr) && arr.ValueKind == JsonValueKind.Array)
            foreach (var e in arr.EnumerateArray())
                if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(idKey, out var idEl) && idEl.TryGetInt32(out var id) && id > 0)
                    ids.Add(id);
        return ids;
    }

    private static async Task RestoreProfileAsync(MySqlConnection conn, MySqlTransaction tx, int memberId, JsonElement prof, bool reactivate, int by)
    {
        if (memberId <= 0 || prof.ValueKind != JsonValueKind.Object) return;
        var sets = new List<string>();
        var pars = new DynamicParameters();
        pars.Add("Id", memberId);
        pars.Add("By", by);
        foreach (var (key, col) in ProfileRestoreColumns)
        {
            if (!prof.TryGetProperty(key, out var el)) continue;
            var p = "p_" + col;
            sets.Add($"{col} = @{p}");
            pars.Add(p, ToDbValue(el));
        }
        if (reactivate) { sets.Add("isdeleted = 0"); sets.Add("deleted_by = NULL"); sets.Add("deleted_date = NULL"); }
        sets.Add("modified_by = @By");
        sets.Add("modified_date = NOW()");
        await conn.ExecuteAsync($"UPDATE member_master_profile SET {string.Join(", ", sets)} WHERE pk_member_master_profile_id = @Id", pars, tx);
    }

    public class RevertRequest { public int KeptId { get; set; } public int DeletedId { get; set; } }

    [HttpPost("revert")]
    public async Task<IActionResult> Revert([FromBody] RevertRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.KeptId <= 0 || req.DeletedId <= 0 || req.KeptId == req.DeletedId)
            return BadRequest(new { message = "keptId and deletedId must be two distinct members." });

        var by = GetUserId();
        await using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);

        var snapJson = await conn.ExecuteScalarAsync<string?>(
            @"SELECT snapshot FROM bak_member_dup_merge
              WHERE kept_member_id = @K AND deleted_member_id = @D
              ORDER BY pk_id DESC LIMIT 1", new { K = req.KeptId, D = req.DeletedId });
        if (string.IsNullOrWhiteSpace(snapJson))
            return NotFound(new { message = "No merge backup found for this pair — nothing to revert." });

        using var doc = JsonDocument.Parse(snapJson);
        var root = doc.RootElement;
        if (!root.TryGetProperty("delete", out var delProf) || !root.TryGetProperty("keep", out var keepProf))
            return StatusCode(500, new { message = "Merge backup is malformed — cannot revert automatically." });

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
            // Free UNIQUE fields on both first so restoring exact snapshot values never trips a transient
            // collision (e.g. RotaryId that was shifted onto the survivor during the merge).
            await conn.ExecuteAsync(@"UPDATE member_master_profile
                SET RotaryId = NULL, PrimaryMobileNumber = NULL, SecondaryMobileNumber = NULL, EmailId = NULL, SecondaryEmailId = NULL
                WHERE pk_member_master_profile_id IN (@A, @B)", new { A = req.KeptId, B = req.DeletedId }, tx);

            // Restore both profiles from the snapshot (survivor first, then reactivate the deleted member).
            await RestoreProfileAsync(conn, tx, req.KeptId, keepProf, reactivate: false, by);
            await RestoreProfileAsync(conn, tx, req.DeletedId, delProf, reactivate: true, by);

            // Reactivate the club links captured in the snapshot (by primary key). Non-destructive.
            var clubPks = PksFromArray(root, "deleteClubs", "clubMemberId").Concat(PksFromArray(root, "keepClubs", "clubMemberId")).Distinct().ToList();
            if (clubPks.Count > 0)
                await conn.ExecuteAsync(@"UPDATE club_members
                    SET isdeleted = 0, IsActive = 1, deleted_by = NULL, deleted_date = NULL, modified_by = @By, modified_date = NOW()
                    WHERE pk_club_member_id IN @Pks", new { Pks = clubPks, By = by }, tx);

            // Move family rows back to their original owner (by primary key).
            var delFamPks = PksFromArray(root, "deleteFamily", "familyId");
            if (delFamPks.Count > 0)
                await conn.ExecuteAsync(@"UPDATE member_family_details SET fk_member_master_profile_id = @Owner, isdeleted = 0, modified_date = NOW()
                    WHERE pk_member_family_details_id IN @Pks", new { Owner = req.DeletedId, Pks = delFamPks }, tx);
            var keepFamPks = PksFromArray(root, "keepFamily", "familyId");
            if (keepFamPks.Count > 0)
                await conn.ExecuteAsync(@"UPDATE member_family_details SET fk_member_master_profile_id = @Owner, isdeleted = 0, modified_date = NOW()
                    WHERE pk_member_family_details_id IN @Pks", new { Owner = req.KeptId, Pks = keepFamPks }, tx);

            await tx.CommitAsync();
        }
        catch (Exception)
        {
            await tx.RollbackAsync();
            return StatusCode(500, new { message = "Revert failed and was rolled back." });
        }

        var loserHadRoles = root.TryGetProperty("deleteRoles", out var dr) && dr.ValueKind == JsonValueKind.Array && dr.GetArrayLength() > 0;
        return Ok(new
        {
            success = true,
            restoredMemberId = req.DeletedId,
            rolesNote = loserHadRoles
                ? "The deleted member had roles that were transferred during the merge and could NOT be auto-restored — please re-check that member's roles manually."
                : null,
        });
    }

    // GET recent merges that can be reverted (most recent first).
    [HttpGet("merge-history")]
    public async Task<IActionResult> MergeHistory([FromQuery] int limit = 50)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (limit is < 1 or > 200) limit = 50;
        await using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureTablesAsync(conn);
        var rows = await conn.QueryAsync(@"
            SELECT b.pk_id AS id, b.kept_member_id AS keptId, b.deleted_member_id AS deletedId, b.created_date AS mergedOn,
                   k.MemberName AS keptName, k.RotaryId AS keptRid,
                   d.MemberName AS deletedName, d.RotaryId AS deletedRid,
                   d.PrimaryMobileNumber AS deletedMobile, d.isdeleted AS deletedStillGone
            FROM bak_member_dup_merge b
            LEFT JOIN member_master_profile k ON k.pk_member_master_profile_id = b.kept_member_id
            LEFT JOIN member_master_profile d ON d.pk_member_master_profile_id = b.deleted_member_id
            ORDER BY b.pk_id DESC LIMIT @Limit", new { Limit = limit });
        return Ok(rows);
    }

    // GET districts + clubs for the "add club" picker in the popup.
    [HttpGet("districts")]
    public async Task<IActionResult> Districts()
    {
        if (!IsSuperAdmin()) return Forbid();
        await using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync(@"
            SELECT pk_district_id AS id, DistrictNumber AS districtNumber
            FROM district_master WHERE isdeleted = 0 ORDER BY DistrictNumber");
        return Ok(rows);
    }

    [HttpGet("clubs")]
    public async Task<IActionResult> Clubs([FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (districtId <= 0) return BadRequest(new { message = "districtId required." });
        await using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync(@"
            SELECT pk_club_id AS id, ClubName AS clubName
            FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 ORDER BY ClubName",
            new { D = districtId });
        return Ok(rows);
    }
}
