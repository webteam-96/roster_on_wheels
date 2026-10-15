namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Normalizes Indian state names sent by Rotary.org into the canonical full
/// spelling stored in club_master.State.
///
/// Rotary.org's /clubs/{name}/{id} endpoint returns State in wildly different
/// forms per club — the 2-letter code ("MH"), a 3-4 letter shorthand ("MAHA"),
/// a typo ("Maharastra" missing an "h"), an old name ("Orissa"), or the
/// canonical name ("Maharashtra"). This maps all known variants to the one
/// canonical form so listings, filters, and reports stay consistent.
///
/// Only applied when the country is India. For non-India clubs the raw value
/// passes through untouched (per user 2026-07-10).
///
/// If no match is found the raw value is returned as-is (not blanked) so we
/// never accidentally lose data.
/// </summary>
public static class IndianStateResolver
{
    private static readonly HashSet<string> IndiaCountries = new(StringComparer.OrdinalIgnoreCase)
    {
        "India", "IN", "IND", "Bharat", "भारत"
    };

    // Every canonical Indian state / UT plus every variant we've seen from
    // Rotary.org. All lookups are case-insensitive. Keys are compared after
    // Trim() so trailing / leading whitespace is fine.
    private static readonly Dictionary<string, string> Map = new(StringComparer.OrdinalIgnoreCase)
    {
        // ─── 2-letter codes (ISO 3166-2 IN-* subset) ───
        ["AN"] = "Andaman and Nicobar Islands",
        ["AP"] = "Andhra Pradesh",
        ["AR"] = "Arunachal Pradesh",
        ["AS"] = "Assam",
        ["BR"] = "Bihar",
        ["CG"] = "Chhattisgarh",
        ["CH"] = "Chandigarh",
        ["DD"] = "Daman and Diu",
        ["DL"] = "Delhi",
        ["DN"] = "Dadra and Nagar Haveli",
        ["GA"] = "Goa",
        ["GJ"] = "Gujarat",
        ["HR"] = "Haryana",
        ["HP"] = "Himachal Pradesh",
        ["JK"] = "Jammu and Kashmir",
        ["JH"] = "Jharkhand",
        ["KA"] = "Karnataka",
        ["KL"] = "Kerala",
        ["LA"] = "Ladakh",
        ["LD"] = "Lakshadweep",
        ["MP"] = "Madhya Pradesh",
        ["MH"] = "Maharashtra",
        ["MN"] = "Manipur",
        ["ML"] = "Meghalaya",
        ["MZ"] = "Mizoram",
        ["NL"] = "Nagaland",
        ["OD"] = "Odisha",
        ["OR"] = "Odisha",          // legacy 2-letter code
        ["PY"] = "Puducherry",
        ["PB"] = "Punjab",
        ["RJ"] = "Rajasthan",
        ["SK"] = "Sikkim",
        ["TN"] = "Tamil Nadu",
        ["TS"] = "Telangana",
        ["TG"] = "Telangana",       // some data sources use TG
        ["TR"] = "Tripura",
        ["UP"] = "Uttar Pradesh",
        ["UK"] = "Uttarakhand",
        ["UT"] = "Uttarakhand",
        ["WB"] = "West Bengal",

        // ─── 3-4 letter Rotary.org shorthand ───
        ["MAHA"] = "Maharashtra",
        ["KARN"] = "Karnataka",
        ["TAMI"] = "Tamil Nadu",
        ["TAMN"] = "Tamil Nadu",
        ["GUJ"]  = "Gujarat",
        ["GUJA"] = "Gujarat",
        ["RAJ"]  = "Rajasthan",
        ["RAJA"] = "Rajasthan",
        ["KER"]  = "Kerala",
        ["KERA"] = "Kerala",
        ["WBEN"] = "West Bengal",
        ["ANDR"] = "Andhra Pradesh",
        ["TELA"] = "Telangana",
        ["ODIS"] = "Odisha",
        ["ORIS"] = "Odisha",
        ["PUNJ"] = "Punjab",
        ["HARY"] = "Haryana",
        ["HIMA"] = "Himachal Pradesh",
        ["JHAR"] = "Jharkhand",
        ["ASSA"] = "Assam",
        ["BIHA"] = "Bihar",
        ["MADH"] = "Madhya Pradesh",
        ["CHHA"] = "Chhattisgarh",
        ["CHAT"] = "Chhattisgarh",
        ["MEGH"] = "Meghalaya",
        ["MANI"] = "Manipur",
        ["MIZO"] = "Mizoram",
        ["NAGA"] = "Nagaland",
        ["ARUN"] = "Arunachal Pradesh",
        ["TRIP"] = "Tripura",
        ["SIKK"] = "Sikkim",
        ["GOA"]  = "Goa",
        ["DELH"] = "Delhi",
        ["PUDU"] = "Puducherry",
        ["POND"] = "Puducherry",
        ["CHAN"] = "Chandigarh",
        ["LADA"] = "Ladakh",
        ["LAKS"] = "Lakshadweep",
        ["AND "] = "Andhra Pradesh",  // rare
        ["JAMM"] = "Jammu and Kashmir",

        // ─── Old / renamed names ───
        ["Orissa"] = "Odisha",
        ["Pondicherry"] = "Puducherry",
        ["Uttaranchal"] = "Uttarakhand",
        ["NCT of Delhi"] = "Delhi",
        ["NCR"] = "Delhi",

        // ─── Common typos / spelling variants ───
        ["Maharastra"] = "Maharashtra",       // missing "h"
        ["Maharshtra"] = "Maharashtra",       // missing "a"
        ["Maharasthra"] = "Maharashtra",      // extra "h"
        ["Chattisgarh"] = "Chhattisgarh",     // missing "h"
        ["Chhatisgarh"] = "Chhattisgarh",     // missing "t"
        ["Tamilnadu"] = "Tamil Nadu",         // no space
        ["Tamil-Nadu"] = "Tamil Nadu",
        ["Uttar-Pradesh"] = "Uttar Pradesh",
        ["Madhya-Pradesh"] = "Madhya Pradesh",
        ["Himachal-Pradesh"] = "Himachal Pradesh",
        ["West-Bengal"] = "West Bengal",
        ["West Bengal "] = "West Bengal",     // trailing space (handled by Trim, defensive)
        ["Andhra"] = "Andhra Pradesh",
        ["Andhra-Pradesh"] = "Andhra Pradesh",
        ["Arunachal"] = "Arunachal Pradesh",
        ["Arunachal-Pradesh"] = "Arunachal Pradesh",
        ["JammuKashmir"] = "Jammu and Kashmir",
        ["Jammu & Kashmir"] = "Jammu and Kashmir",
        ["Jammu And Kashmir"] = "Jammu and Kashmir",
        ["J&K"] = "Jammu and Kashmir",
        ["Kashmir"] = "Jammu and Kashmir",
        ["Dadra and Nagar Haveli and Daman and Diu"] = "Dadra and Nagar Haveli",
        ["Andaman & Nicobar"] = "Andaman and Nicobar Islands",
        ["Andaman and Nicobar"] = "Andaman and Nicobar Islands",
        ["A & N Islands"] = "Andaman and Nicobar Islands",

        // ─── Canonical full names — pass-through with correct casing ───
        // (also protects against upper/lower/mixed-case variants like "MAHARASHTRA" / "maharashtra")
        ["Andaman and Nicobar Islands"] = "Andaman and Nicobar Islands",
        ["Andhra Pradesh"] = "Andhra Pradesh",
        ["Arunachal Pradesh"] = "Arunachal Pradesh",
        ["Assam"] = "Assam",
        ["Bihar"] = "Bihar",
        ["Chandigarh"] = "Chandigarh",
        ["Chhattisgarh"] = "Chhattisgarh",
        ["Dadra and Nagar Haveli"] = "Dadra and Nagar Haveli",
        ["Daman and Diu"] = "Daman and Diu",
        ["Delhi"] = "Delhi",
        ["Goa"] = "Goa",
        ["Gujarat"] = "Gujarat",
        ["Haryana"] = "Haryana",
        ["Himachal Pradesh"] = "Himachal Pradesh",
        ["Jammu and Kashmir"] = "Jammu and Kashmir",
        ["Jharkhand"] = "Jharkhand",
        ["Karnataka"] = "Karnataka",
        ["Kerala"] = "Kerala",
        ["Ladakh"] = "Ladakh",
        ["Lakshadweep"] = "Lakshadweep",
        ["Madhya Pradesh"] = "Madhya Pradesh",
        ["Maharashtra"] = "Maharashtra",
        ["Manipur"] = "Manipur",
        ["Meghalaya"] = "Meghalaya",
        ["Mizoram"] = "Mizoram",
        ["Nagaland"] = "Nagaland",
        ["Odisha"] = "Odisha",
        ["Puducherry"] = "Puducherry",
        ["Punjab"] = "Punjab",
        ["Rajasthan"] = "Rajasthan",
        ["Sikkim"] = "Sikkim",
        ["Tamil Nadu"] = "Tamil Nadu",
        ["Telangana"] = "Telangana",
        ["Tripura"] = "Tripura",
        ["Uttar Pradesh"] = "Uttar Pradesh",
        ["Uttarakhand"] = "Uttarakhand",
        ["West Bengal"] = "West Bengal",
    };

    /// <summary>True if the country string identifies India in any known form.</summary>
    public static bool IsIndia(string? country)
        => !string.IsNullOrWhiteSpace(country) && IndiaCountries.Contains(country.Trim());

    /// <summary>
    /// Normalize a state string for an Indian club. Returns the canonical
    /// full-spelling name (e.g. "Maharashtra") for any recognised variant.
    /// Unknown values pass through UNCHANGED — never returns null for a
    /// non-empty input, never blanks unknown data.
    /// </summary>
    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return raw;
        var trimmed = raw.Trim();
        return Map.TryGetValue(trimmed, out var canonical) ? canonical : trimmed;
    }

    /// <summary>
    /// Only normalize when Country identifies India — non-India clubs get
    /// the raw value back untouched (per user 2026-07-10).
    /// </summary>
    public static string? NormalizeForCountry(string? state, string? country)
        => IsIndia(country) ? Normalize(state) : state;
}
