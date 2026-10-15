namespace RotaryApi.Services.RotaryOrg;

/// <summary>
/// Normalizes Indian state names sent by Rotary.org into the canonical full
/// spelling stored in club_master.State. Mirror of the identical file in the
/// RotaryOrgSyncWorker (both projects sync clubs; both need the same map).
///
/// Only applied when the country is India — non-India clubs pass through
/// untouched. Unknown values pass through as-is (never blanked).
/// </summary>
public static class IndianStateResolver
{
    private static readonly HashSet<string> IndiaCountries = new(StringComparer.OrdinalIgnoreCase)
    {
        "India", "IN", "IND", "Bharat", "भारत"
    };

    private static readonly Dictionary<string, string> Map = new(StringComparer.OrdinalIgnoreCase)
    {
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
        ["OR"] = "Odisha",
        ["PY"] = "Puducherry",
        ["PB"] = "Punjab",
        ["RJ"] = "Rajasthan",
        ["SK"] = "Sikkim",
        ["TN"] = "Tamil Nadu",
        ["TS"] = "Telangana",
        ["TG"] = "Telangana",
        ["TR"] = "Tripura",
        ["UP"] = "Uttar Pradesh",
        ["UK"] = "Uttarakhand",
        ["UT"] = "Uttarakhand",
        ["WB"] = "West Bengal",

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
        ["JAMM"] = "Jammu and Kashmir",

        ["Orissa"] = "Odisha",
        ["Pondicherry"] = "Puducherry",
        ["Uttaranchal"] = "Uttarakhand",
        ["NCT of Delhi"] = "Delhi",
        ["NCR"] = "Delhi",

        ["Maharastra"] = "Maharashtra",
        ["Maharshtra"] = "Maharashtra",
        ["Maharasthra"] = "Maharashtra",
        ["Chattisgarh"] = "Chhattisgarh",
        ["Chhatisgarh"] = "Chhattisgarh",
        ["Tamilnadu"] = "Tamil Nadu",
        ["Tamil-Nadu"] = "Tamil Nadu",
        ["Uttar-Pradesh"] = "Uttar Pradesh",
        ["Madhya-Pradesh"] = "Madhya Pradesh",
        ["Himachal-Pradesh"] = "Himachal Pradesh",
        ["West-Bengal"] = "West Bengal",
        ["Andhra"] = "Andhra Pradesh",
        ["Andhra-Pradesh"] = "Andhra Pradesh",
        ["Arunachal"] = "Arunachal Pradesh",
        ["Arunachal-Pradesh"] = "Arunachal Pradesh",
        ["JammuKashmir"] = "Jammu and Kashmir",
        ["Jammu & Kashmir"] = "Jammu and Kashmir",
        ["Jammu And Kashmir"] = "Jammu and Kashmir",
        ["J&K"] = "Jammu and Kashmir",
        ["Kashmir"] = "Jammu and Kashmir",
        ["Andaman & Nicobar"] = "Andaman and Nicobar Islands",
        ["Andaman and Nicobar"] = "Andaman and Nicobar Islands",
        ["A & N Islands"] = "Andaman and Nicobar Islands",

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

    public static bool IsIndia(string? country)
        => !string.IsNullOrWhiteSpace(country) && IndiaCountries.Contains(country.Trim());

    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return raw;
        var trimmed = raw.Trim();
        return Map.TryGetValue(trimmed, out var canonical) ? canonical : trimmed;
    }

    public static string? NormalizeForCountry(string? state, string? country)
        => IsIndia(country) ? Normalize(state) : state;
}
