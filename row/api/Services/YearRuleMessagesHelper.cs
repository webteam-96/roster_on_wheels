using Dapper;
using Microsoft.Extensions.Caching.Memory;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// The "View only" wording shown when the year rule withholds Add / Edit /
/// Delete — read and written in ONE place, for both clients.
///
/// The four sentences used to be compiled into web's <c>ViewOnlyBadge</c> and
/// mobile's <c>ViewOnlyNotice</c>. Changing a word meant a web deploy plus an
/// app-store release, and the two had already drifted (web named the year,
/// mobile said "this Rotary year"). SuperAdmin now edits them on Settings →
/// Year-wise Admin Rights and both clients render the same text.
///
/// ── What this class does NOT do ─────────────────────────────────────────────
/// It never decides a permission, and the wording never reaches the guard.
/// <see cref="AdminYearService"/> and <see cref="AdminYearGuard"/> decide who
/// may write; this is only how the refusal is explained to a reader.
///
/// ── Templates, not finished sentences ───────────────────────────────────────
/// The server does not know which screen is asking — whether a year is on
/// screen, which years the reader holds, or what action is blocked. So it sends
/// TEMPLATES and each client substitutes its own tokens:
///
///   {year}        the Rotary year on screen        → "this Rotary year"
///   {currentYear} the current Rotary year's label  → "the current year"
///   {years}       the years this member may edit   → "" (clause dropped)
///   {actions}     what is being withheld           → DefaultActions
///
/// Both clients implement the same substitution, including dropping an empty
/// "()" left behind by a missing {currentYear}. Change the rule here and it has
/// to change in <c>ViewOnlyBadge.tsx</c> and <c>view_only_notice.dart</c> too.
/// </summary>
public class YearRuleMessagesHelper
{
    private readonly IMemoryCache _cache;
    private readonly string _connectionString;

    public YearRuleMessagesHelper(IConfiguration config, IMemoryCache cache)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _cache = cache;
    }

    // ── Keys ────────────────────────────────────────────────────────────────

    public const string KeyCurrentYearOnly = "current_year_only";
    public const string KeyWrongYearWithYears = "wrong_year_with_years";
    public const string KeyWrongYearNoYears = "wrong_year_no_years";
    public const string KeyDefaultActions = "default_actions";

    public static readonly string[] AllKeys =
    {
        KeyCurrentYearOnly, KeyWrongYearWithYears, KeyWrongYearNoYears, KeyDefaultActions,
    };

    /// <summary>
    /// The factory wording — WHAT BOTH CLIENTS ALREADY SAID before this feature,
    /// so turning it on changes nothing on screen until a SuperAdmin edits it.
    ///
    /// ⚠️ Also duplicated in SQL/year_rule_messages.sql, DatabaseInitializer, and
    /// as a last-resort fallback in each client (for an empty row or an older
    /// server). Change one, change all of them.
    /// </summary>
    public static readonly Dictionary<string, string> Defaults = new()
    {
        [KeyCurrentYearOnly] =
            "View only: Only an admin for the current year ({currentYear}) can {actions}.",
        [KeyWrongYearWithYears] =
            "View only: you are not an admin for {year}, so you cannot add, edit or delete these records. You can make changes in {years}.",
        [KeyWrongYearNoYears] =
            "View only: you are not an admin for {year}, so you cannot add, edit or delete these records.",
        [KeyDefaultActions] =
            "add, edit or delete it",
    };

    /// <summary>What the clients receive. One object, four sentences.</summary>
    public class MessagesDto
    {
        public string CurrentYearOnly { get; set; } = Defaults[KeyCurrentYearOnly];
        public string WrongYearWithYears { get; set; } = Defaults[KeyWrongYearWithYears];
        public string WrongYearNoYears { get; set; } = Defaults[KeyWrongYearNoYears];
        public string DefaultActions { get; set; } = Defaults[KeyDefaultActions];
    }

    // ── Cache ───────────────────────────────────────────────────────────────
    //
    // my-context is called once per app open / page mount rather than per write,
    // so this is nothing like the ~313 reads YearRuleScopeHelper serves. It is
    // cached anyway because the settings page reads it on every keystroke of the
    // live preview, and because a wording change should not cost a query on every
    // login. Invalidate() on save means an edit is visible immediately; the TTL
    // only covers another instance behind a load balancer.

    private const string CacheKey = "yearrulemessages:v1";
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);

    public void Invalidate() => _cache.Remove(CacheKey);

    /// <summary>
    /// The four templates, falling back to <see cref="Defaults"/> for any row
    /// that is missing, soft-deleted or blank.
    ///
    /// Opens its own connection on a cache miss. Deliberately parameterless: no
    /// caller is inside a transaction, and taking a connection it does not need
    /// (because the answer is usually cached) would push a pointless open onto
    /// every caller.
    ///
    /// NEVER throws. A missing table — the migration not yet applied by hand on
    /// this database — returns the defaults, because a wording lookup must not be
    /// able to break login or the member dashboard.
    /// </summary>
    public async Task<MessagesDto> GetAsync()
    {
        if (_cache.TryGetValue(CacheKey, out MessagesDto? hit) && hit != null) return hit;

        var dto = new MessagesDto();
        try
        {
            await using var conn = RowDb.Connect(_connectionString);
            await conn.OpenAsync();

            var rows = await conn.QueryAsync<(string MessageKey, string Template)>(@"
                SELECT MessageKey, Template
                FROM year_rule_messages
                WHERE COALESCE(isdeleted, 0) = 0");

            foreach (var row in rows)
            {
                // Blank is treated as "not set", so clearing the box on the settings
                // page is the same thing as Reset to default.
                if (string.IsNullOrWhiteSpace(row.Template)) continue;
                var t = row.Template.Trim();
                switch (row.MessageKey)
                {
                    case KeyCurrentYearOnly: dto.CurrentYearOnly = t; break;
                    case KeyWrongYearWithYears: dto.WrongYearWithYears = t; break;
                    case KeyWrongYearNoYears: dto.WrongYearNoYears = t; break;
                    case KeyDefaultActions: dto.DefaultActions = t; break;
                }
            }
        }
        catch (MySqlException)
        {
            // Table not there yet. Defaults are already in `dto` — and they are the
            // same words the clients would have shown anyway.
        }

        _cache.Set(CacheKey, dto, Ttl);
        return dto;
    }

    /// <summary>The raw stored rows, for the settings editor. No defaults filled in.</summary>
    public async Task<Dictionary<string, StoredMessage>> GetStoredAsync()
    {
        var result = new Dictionary<string, StoredMessage>();
        try
        {
            await using var conn = RowDb.Connect(_connectionString);
            await conn.OpenAsync();

            var rows = await conn.QueryAsync<StoredMessage>(@"
                SELECT m.MessageKey AS MessageKey,
                       m.Template   AS Template,
                       DATE_FORMAT(COALESCE(m.modified_date, m.created_date), '%d %b %Y, %h:%i %p') AS ModifiedDate,
                       p.MemberName AS ModifiedByName
                FROM year_rule_messages m
                LEFT JOIN member_master_profile p
                       ON p.pk_member_master_profile_id = COALESCE(m.modified_by, m.created_by)
                WHERE COALESCE(m.isdeleted, 0) = 0");

            foreach (var row in rows)
                if (!string.IsNullOrWhiteSpace(row.MessageKey)) result[row.MessageKey] = row;
        }
        catch (MySqlException)
        {
            // Migration not applied on this database — nothing stored, so the editor
            // shows the defaults with no "edited by" line. Correct, not an error.
        }
        return result;
    }

    public class StoredMessage
    {
        public string MessageKey { get; set; } = "";
        public string Template { get; set; } = "";
        public string? ModifiedDate { get; set; }
        public string? ModifiedByName { get; set; }
    }

    // ── Writes ──────────────────────────────────────────────────────────────
    // Here rather than in the controller so no caller can save a row and forget
    // to invalidate the cache.

    /// <summary>
    /// Save one message. A blank template RESETS it — see <see cref="ResetAsync"/>,
    /// which this forwards to, so "clear the box" and "press Reset" cannot end up
    /// meaning two different things.
    /// </summary>
    public async Task SetAsync(string messageKey, string? template, int byMemberId)
    {
        if (!AllKeys.Contains(messageKey))
            throw new ArgumentException($"Unknown message key \"{messageKey}\".", nameof(messageKey));

        if (string.IsNullOrWhiteSpace(template))
        {
            await ResetAsync(messageKey, byMemberId);
            return;
        }

        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            INSERT INTO year_rule_messages (MessageKey, Template, created_by, created_date, isdeleted)
            VALUES (@K, @T, @U, NOW(), 0)
            ON DUPLICATE KEY UPDATE
                Template = @T,
                isdeleted = 0,
                modified_by = @U,
                modified_date = NOW()",
            new { K = messageKey, T = template.Trim(), U = byMemberId });
        Invalidate();
    }

    /// <summary>
    /// Back to the factory wording. Soft delete, so the audit trail and the
    /// original created_by survive and <see cref="SetAsync"/> revives the row —
    /// the same shape as clearing a scope override.
    /// </summary>
    public async Task ResetAsync(string messageKey, int byMemberId)
    {
        if (!AllKeys.Contains(messageKey))
            throw new ArgumentException($"Unknown message key \"{messageKey}\".", nameof(messageKey));

        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE year_rule_messages
            SET isdeleted = 1, modified_by = @U, modified_date = NOW()
            WHERE MessageKey = @K",
            new { K = messageKey, U = byMemberId });
        Invalidate();
    }

    // ── Validation ──────────────────────────────────────────────────────────

    /// <summary>
    /// Why this template cannot be saved, or null when it is fine.
    ///
    /// Deliberately permissive: a SuperAdmin may drop any token, reorder the
    /// sentence or write it in another language. Only two things are refused —
    /// text so long it would bury the screen, and a token that does not exist,
    /// which would otherwise be shown to every member as literal "{yr}".
    /// </summary>
    public static string? Validate(string messageKey, string? template)
    {
        if (string.IsNullOrWhiteSpace(template)) return null;   // = reset, always allowed
        var t = template.Trim();

        if (t.Length > 400)
            return "That message is too long. Keep it under 400 characters so it fits on a phone.";

        var unknown = System.Text.RegularExpressions.Regex
            .Matches(t, @"\{([A-Za-z0-9_]*)\}")
            .Select(m => m.Groups[1].Value)
            .Where(name => name is not ("year" or "currentYear" or "years" or "actions"))
            .Distinct()
            .ToList();

        if (unknown.Count > 0)
            return $"Unknown placeholder{(unknown.Count > 1 ? "s" : "")}: " +
                   string.Join(", ", unknown.Select(u => "{" + u + "}")) +
                   ". Use {year}, {currentYear}, {years} or {actions}.";

        // {years} is the ONLY token whose value can legitimately be empty, and the
        // clients drop the clause around it by choosing a different template. So a
        // SuperAdmin who puts {years} in the no-years message would write a sentence
        // that renders with a hole in it.
        if (messageKey == KeyWrongYearNoYears && t.Contains("{years}"))
            return "{years} cannot be used here: this message is shown exactly when the member holds no editable years.";

        if (messageKey == KeyDefaultActions && (t.Contains("{actions}") || t.Contains("{years}")))
            return "This is the phrase {actions} itself, so it cannot contain {actions} or {years}.";

        return null;
    }
}
