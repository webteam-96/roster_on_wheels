namespace RotaryApi.Services;

// Rotary.org /clubs also lists Rotaract clubs, so the sync stores them in club_master with
// ClubType = 'Rotaract Club'. User 2026-10-08: SuperAdmin keeps seeing them; District Admin and
// Club Admin screens, lists, counts and reports must not. Append NotRotaract() to those queries.
public static class ClubScopeSql
{
    public const string RotaractType = "Rotaract Club";

    /// User 2026-10-09: Rotaract clubs show ONLY in Global Search - no district or club screen lists
    /// or counts them for anyone, SuperAdmin included. The old "SuperAdmin sees them" exception is
    /// gone; the parameter is kept so every call site reads the same and the rule lives here only.
    public static bool HideRotaract(bool isSuperAdmin) => true;

    /// SQL predicate that drops Rotaract clubs. alias "" = unaliased column.
    public static string NotRotaract(string alias = "c") =>
        $"COALESCE({(string.IsNullOrEmpty(alias) ? "" : alias + ".")}ClubType,'') <> 'Rotaract Club'";
}
