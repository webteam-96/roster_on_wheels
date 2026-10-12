namespace RotaryApi.Services;

// member_address_details.State stores the full state name ("Maharashtra") — there is
// no code column anywhere in the schema. Some partner integrations (e.g. Shrigoda)
// expect the standard 2-letter vehicle-registration/GST-style code ("MH") instead.
// Falls back to the raw state name for anything unmapped (non-Indian members, typos).
public static class IndianStateCodeLookup
{
    private static readonly Dictionary<string, string> Codes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Andhra Pradesh"] = "AP",
        ["Arunachal Pradesh"] = "AR",
        ["Assam"] = "AS",
        ["Bihar"] = "BR",
        ["Chhattisgarh"] = "CG",
        ["Goa"] = "GA",
        ["Gujarat"] = "GJ",
        ["Haryana"] = "HR",
        ["Himachal Pradesh"] = "HP",
        ["Jharkhand"] = "JH",
        ["Karnataka"] = "KA",
        ["Kerala"] = "KL",
        ["Madhya Pradesh"] = "MP",
        ["Maharashtra"] = "MH",
        ["Manipur"] = "MN",
        ["Meghalaya"] = "ML",
        ["Mizoram"] = "MZ",
        ["Nagaland"] = "NL",
        ["Odisha"] = "OR",
        ["Orissa"] = "OR",
        ["Punjab"] = "PB",
        ["Rajasthan"] = "RJ",
        ["Sikkim"] = "SK",
        ["Tamil Nadu"] = "TN",
        ["Telangana"] = "TS",
        ["Tripura"] = "TR",
        ["Uttar Pradesh"] = "UP",
        ["Uttarakhand"] = "UK",
        ["West Bengal"] = "WB",
        ["Andaman and Nicobar Islands"] = "AN",
        ["Chandigarh"] = "CH",
        ["Dadra and Nagar Haveli and Daman and Diu"] = "DN",
        ["Delhi"] = "DL",
        ["NCT of Delhi"] = "DL",
        ["Jammu and Kashmir"] = "JK",
        ["Ladakh"] = "LA",
        ["Lakshadweep"] = "LD",
        ["Puducherry"] = "PY",
        ["Pondicherry"] = "PY",
    };

    public static string ToCode(string? stateName)
    {
        if (string.IsNullOrWhiteSpace(stateName)) return "";
        return Codes.TryGetValue(stateName.Trim(), out var code) ? code : stateName.Trim();
    }
}
