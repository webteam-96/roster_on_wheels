namespace RotaryApi.Services;

/// <summary>
/// The currency of each country, keyed by the names used in district_master.Country and country_master.CountryName
/// (Rotary writes "Korea, Republic of", "England"; country_master "South Korea", "United Kingdom").
/// </summary>
public static class CountryCurrency
{
    private static readonly (string Code, string[] Countries)[] Table =
    {
        ("USD", new[] { "United States", "Puerto Rico", "Guam", "American Samoa", "Ecuador", "El Salvador", "Marshall Islands", "Micronesia", "Palau", "Timor-Leste", "Virgin Islands (US)", "Northern Mariana Islands" }),
        ("EUR", new[] { "Andorra", "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Estonia", "Finland", "France", "Germany", "Greece", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Monaco", "Montenegro", "Netherlands", "Portugal", "San Marino", "Slovakia", "Slovenia", "Spain", "Vatican City", "Kosovo" }),
        ("GBP", new[] { "United Kingdom", "England", "Scotland", "Wales", "Northern Ireland" }),
        ("AUD", new[] { "Australia", "Kiribati", "Nauru", "Tuvalu" }),
        ("NZD", new[] { "New Zealand", "Cook Islands" }),
        ("CHF", new[] { "Switzerland", "Liechtenstein" }),
        ("ILS", new[] { "Israel", "Palestine" }),
        ("XOF", new[] { "Benin", "Burkina Faso", "Guinea-Bissau", "Ivory Coast", "Cote d'Ivoire", "Mali", "Niger", "Senegal", "Togo" }),
        ("XAF", new[] { "Cameroon", "Central African Republic", "Chad", "Congo (Republic)", "Equatorial Guinea", "Gabon" }),
        ("XCD", new[] { "Anguilla", "Antigua and Barbuda", "Dominica", "Grenada", "Montserrat", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines" }),
        ("XPF", new[] { "New Caledonia", "French Polynesia" }),
        ("AED", new[] { "United Arab Emirates" }), ("AFN", new[] { "Afghanistan" }), ("ALL", new[] { "Albania" }),
        ("AMD", new[] { "Armenia" }), ("AOA", new[] { "Angola" }), ("ARS", new[] { "Argentina" }), ("AWG", new[] { "Aruba" }),
        ("AZN", new[] { "Azerbaijan" }), ("BAM", new[] { "Bosnia and Herzegovina" }), ("BBD", new[] { "Barbados" }),
        ("BDT", new[] { "Bangladesh" }), ("BHD", new[] { "Bahrain" }), ("BIF", new[] { "Burundi" }), ("BMD", new[] { "Bermuda" }),
        ("BND", new[] { "Brunei", "Brunei Darussalam" }), ("BOB", new[] { "Bolivia" }), ("BRL", new[] { "Brazil" }),
        ("BSD", new[] { "Bahamas" }), ("BTN", new[] { "Bhutan" }), ("BWP", new[] { "Botswana" }), ("BYN", new[] { "Belarus" }),
        ("BZD", new[] { "Belize" }), ("CAD", new[] { "Canada" }), ("CDF", new[] { "Congo (DRC)" }), ("CLP", new[] { "Chile" }),
        ("CNY", new[] { "China", "China, People's Republic of" }), ("COP", new[] { "Colombia" }), ("CRC", new[] { "Costa Rica" }),
        ("CUP", new[] { "Cuba" }), ("CVE", new[] { "Cabo Verde" }), ("CZK", new[] { "Czech Republic" }), ("DJF", new[] { "Djibouti" }),
        ("DKK", new[] { "Denmark" }), ("DOP", new[] { "Dominican Republic" }), ("DZD", new[] { "Algeria" }), ("EGP", new[] { "Egypt" }),
        ("ERN", new[] { "Eritrea" }), ("ETB", new[] { "Ethiopia" }), ("FJD", new[] { "Fiji" }), ("GEL", new[] { "Georgia" }),
        ("GHS", new[] { "Ghana" }), ("GMD", new[] { "Gambia" }), ("GNF", new[] { "Guinea" }), ("GTQ", new[] { "Guatemala" }),
        ("GYD", new[] { "Guyana" }), ("HKD", new[] { "Hong Kong" }), ("HNL", new[] { "Honduras" }), ("HTG", new[] { "Haiti" }),
        ("HUF", new[] { "Hungary" }), ("IDR", new[] { "Indonesia" }), ("INR", new[] { "India" }), ("IQD", new[] { "Iraq" }),
        ("IRR", new[] { "Iran" }), ("ISK", new[] { "Iceland" }), ("JMD", new[] { "Jamaica" }), ("JOD", new[] { "Jordan" }),
        ("JPY", new[] { "Japan" }), ("KES", new[] { "Kenya" }), ("KGS", new[] { "Kyrgyzstan" }), ("KHR", new[] { "Cambodia" }),
        ("KMF", new[] { "Comoros" }), ("KRW", new[] { "South Korea", "Korea, Republic of" }), ("KWD", new[] { "Kuwait" }),
        ("KZT", new[] { "Kazakhstan" }), ("LAK", new[] { "Laos", "Lao People's Democratic Republic" }), ("LBP", new[] { "Lebanon" }),
        ("LKR", new[] { "Sri Lanka" }), ("LRD", new[] { "Liberia" }), ("LSL", new[] { "Lesotho" }), ("LYD", new[] { "Libya" }),
        ("MAD", new[] { "Morocco" }), ("MDL", new[] { "Moldova" }), ("MGA", new[] { "Madagascar" }), ("MKD", new[] { "North Macedonia" }),
        ("MMK", new[] { "Myanmar" }), ("MNT", new[] { "Mongolia" }), ("MOP", new[] { "Macau" }), ("MRU", new[] { "Mauritania" }),
        ("MUR", new[] { "Mauritius" }), ("MVR", new[] { "Maldives" }), ("MWK", new[] { "Malawi" }), ("MXN", new[] { "Mexico" }),
        ("MYR", new[] { "Malaysia" }), ("MZN", new[] { "Mozambique" }), ("NAD", new[] { "Namibia" }), ("NGN", new[] { "Nigeria" }),
        ("NIO", new[] { "Nicaragua" }), ("NOK", new[] { "Norway" }), ("NPR", new[] { "Nepal" }), ("OMR", new[] { "Oman" }),
        ("PAB", new[] { "Panama" }), ("PEN", new[] { "Peru" }), ("PGK", new[] { "Papua New Guinea" }), ("PHP", new[] { "Philippines" }),
        ("PKR", new[] { "Pakistan" }), ("PLN", new[] { "Poland" }), ("PYG", new[] { "Paraguay" }), ("QAR", new[] { "Qatar" }),
        ("RON", new[] { "Romania" }), ("RSD", new[] { "Serbia" }), ("RUB", new[] { "Russia", "Russian Federation" }),
        ("RWF", new[] { "Rwanda" }), ("SAR", new[] { "Saudi Arabia" }), ("SBD", new[] { "Solomon Islands" }), ("SCR", new[] { "Seychelles" }),
        ("SDG", new[] { "Sudan" }), ("SEK", new[] { "Sweden" }), ("SGD", new[] { "Singapore" }), ("SLE", new[] { "Sierra Leone" }),
        ("SOS", new[] { "Somalia" }), ("SRD", new[] { "Suriname" }), ("SSP", new[] { "South Sudan" }), ("STN", new[] { "Sao Tome and Principe" }),
        ("SYP", new[] { "Syria" }), ("SZL", new[] { "Eswatini" }), ("THB", new[] { "Thailand" }), ("TJS", new[] { "Tajikistan" }),
        ("TMT", new[] { "Turkmenistan" }), ("TND", new[] { "Tunisia" }), ("TOP", new[] { "Tonga" }), ("TRY", new[] { "Turkey" }),
        ("TTD", new[] { "Trinidad and Tobago" }), ("TWD", new[] { "Taiwan" }), ("TZS", new[] { "Tanzania", "Tanzania, United Republic of" }),
        ("UAH", new[] { "Ukraine" }), ("UGX", new[] { "Uganda" }), ("UYU", new[] { "Uruguay" }), ("UZS", new[] { "Uzbekistan" }),
        ("VES", new[] { "Venezuela" }), ("VND", new[] { "Vietnam" }), ("VUV", new[] { "Vanuatu" }), ("WST", new[] { "Samoa" }),
        ("YER", new[] { "Yemen" }), ("ZAR", new[] { "South Africa" }), ("ZMW", new[] { "Zambia" }), ("ZWG", new[] { "Zimbabwe" }),
    };

    private static readonly Dictionary<string, string> ByCountry = Table
        .SelectMany(t => t.Countries.Select(c => (c, t.Code)))
        .ToDictionary(x => x.c, x => x.Code, StringComparer.OrdinalIgnoreCase);

    /// <summary>Every currency above, the instance's main ones first (the order the forms offer them in).</summary>
    public static readonly string[] All =
        new[] { "USD", "CAD", "EUR", "GBP", "BRL", "MXN", "JPY", "KRW", "AUD", "PHP", "ZAR", "NGN", "KES", "INR" }
            .Concat(Table.Select(t => t.Code).OrderBy(c => c, StringComparer.Ordinal)).Distinct().ToArray();

    /// <summary>Currencies written without decimals (ISO 4217 exponent 0).</summary>
    private static readonly HashSet<string> NoDecimals = new(StringComparer.OrdinalIgnoreCase)
        { "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF" };

    /// <summary>The country's currency, or null when the country is empty or not known here.</summary>
    public static string? Of(string? country) =>
        !string.IsNullOrWhiteSpace(country) && ByCountry.TryGetValue(country.Trim(), out var code) ? code : null;

    public static bool HasDecimals(string code) => !NoDecimals.Contains(code);
}
