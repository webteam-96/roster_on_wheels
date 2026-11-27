using System.Globalization;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class CurrencyTests
{
    // Every country a district of the instance has (2026-11-25).
    private static readonly string[] DistrictCountries =
    {
            "Afghanistan", "Albania", "Algeria", "American Samoa", "Andorra", "Angola",
            "Anguilla", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria",
            "Azerbaijan", "Bahamas", "Bangladesh", "Belarus", "Belgium", "Belize",
            "Benin", "Bermuda", "Bolivia", "Botswana", "Brazil", "Brunei Darussalam",
            "Bulgaria", "Burundi", "Cambodia", "Canada", "Chile", "China, People's Republic of",
            "Colombia", "Comoros", "Costa Rica", "Croatia", "Czech Republic", "Denmark",
            "Dominican Republic", "Ecuador", "Egypt", "England", "Eritrea", "Estonia",
            "Finland", "France", "Germany", "Ghana", "Greece", "Guam",
            "Hungary", "Iceland", "India", "Indonesia", "Iraq", "Ireland",
            "Israel", "Italy", "Japan", "Kenya", "Korea, Republic of", "Lao People's Democratic Republic",
            "Latvia", "Lesotho", "Liberia", "Liechtenstein", "Lithuania", "Malawi",
            "Malaysia", "Mexico", "Moldova", "Montenegro", "Nepal", "Netherlands",
            "New Caledonia", "New Zealand", "Nigeria", "North Macedonia", "Norway", "Pakistan",
            "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico", "Russian Federation",
            "Scotland", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Taiwan",
            "Tanzania, United Republic of", "Thailand", "Turkey", "Uganda", "Ukraine", "United States",
            "Uruguay", "Venezuela", "Wales",
    };

    // country_master: name and ISO code.
    private static readonly (string Name, string Iso)[] Countries =
    {
        ("India", "IN"), ("Afghanistan", "AF"), ("Albania", "AL"), ("Algeria", "DZ"), ("Andorra", "AD"), ("Angola", "AO"),
        ("Antigua and Barbuda", "AG"), ("Argentina", "AR"), ("Armenia", "AM"), ("Australia", "AU"), ("Austria", "AT"),
        ("Azerbaijan", "AZ"), ("Bahamas", "BS"), ("Bahrain", "BH"), ("Bangladesh", "BD"), ("Barbados", "BB"),
        ("Belarus", "BY"), ("Belgium", "BE"), ("Belize", "BZ"), ("Benin", "BJ"), ("Bhutan", "BT"), ("Bolivia", "BO"),
        ("Bosnia and Herzegovina", "BA"), ("Botswana", "BW"), ("Brazil", "BR"), ("Brunei", "BN"), ("Bulgaria", "BG"),
        ("Burkina Faso", "BF"), ("Burundi", "BI"), ("Cabo Verde", "CV"), ("Cambodia", "KH"), ("Cameroon", "CM"),
        ("Canada", "CA"), ("Central African Republic", "CF"), ("Chad", "TD"), ("Chile", "CL"), ("China", "CN"),
        ("Colombia", "CO"), ("Comoros", "KM"), ("Congo (DRC)", "CD"), ("Congo (Republic)", "CG"), ("Costa Rica", "CR"),
        ("Croatia", "HR"), ("Cuba", "CU"), ("Cyprus", "CY"), ("Czech Republic", "CZ"), ("Denmark", "DK"), ("Djibouti", "DJ"),
        ("Dominica", "DM"), ("Dominican Republic", "DO"), ("Ecuador", "EC"), ("Egypt", "EG"), ("El Salvador", "SV"),
        ("Equatorial Guinea", "GQ"), ("Eritrea", "ER"), ("Estonia", "EE"), ("Eswatini", "SZ"), ("Ethiopia", "ET"),
        ("Fiji", "FJ"), ("Finland", "FI"), ("France", "FR"), ("Gabon", "GA"), ("Gambia", "GM"), ("Georgia", "GE"),
        ("Germany", "DE"), ("Ghana", "GH"), ("Greece", "GR"), ("Grenada", "GD"), ("Guatemala", "GT"), ("Guinea", "GN"),
        ("Guinea-Bissau", "GW"), ("Guyana", "GY"), ("Haiti", "HT"), ("Honduras", "HN"), ("Hungary", "HU"), ("Iceland", "IS"),
        ("Indonesia", "ID"), ("Iran", "IR"), ("Iraq", "IQ"), ("Ireland", "IE"), ("Israel", "IL"), ("Italy", "IT"),
        ("Ivory Coast", "CI"), ("Jamaica", "JM"), ("Japan", "JP"), ("Jordan", "JO"), ("Kazakhstan", "KZ"), ("Kenya", "KE"),
        ("Kiribati", "KI"), ("Kuwait", "KW"), ("Kyrgyzstan", "KG"), ("Laos", "LA"), ("Latvia", "LV"), ("Lebanon", "LB"),
        ("Lesotho", "LS"), ("Liberia", "LR"), ("Libya", "LY"), ("Liechtenstein", "LI"), ("Lithuania", "LT"),
        ("Luxembourg", "LU"), ("Madagascar", "MG"), ("Malawi", "MW"), ("Malaysia", "MY"), ("Maldives", "MV"), ("Mali", "ML"),
        ("Malta", "MT"), ("Marshall Islands", "MH"), ("Mauritania", "MR"), ("Mauritius", "MU"), ("Mexico", "MX"),
        ("Micronesia", "FM"), ("Moldova", "MD"), ("Monaco", "MC"), ("Mongolia", "MN"), ("Montenegro", "ME"),
        ("Morocco", "MA"), ("Mozambique", "MZ"), ("Myanmar", "MM"), ("Namibia", "NA"), ("Nauru", "NR"), ("Nepal", "NP"),
        ("Netherlands", "NL"), ("New Zealand", "NZ"), ("Nicaragua", "NI"), ("Niger", "NE"), ("Nigeria", "NG"),
        ("North Korea", "KP"), ("North Macedonia", "MK"), ("Norway", "NO"), ("Oman", "OM"), ("Pakistan", "PK"),
        ("Palau", "PW"), ("Palestine", "PS"), ("Panama", "PA"), ("Papua New Guinea", "PG"), ("Paraguay", "PY"),
        ("Peru", "PE"), ("Philippines", "PH"), ("Poland", "PL"), ("Portugal", "PT"), ("Qatar", "QA"), ("Romania", "RO"),
        ("Russia", "RU"), ("Rwanda", "RW"), ("Saint Kitts and Nevis", "KN"), ("Saint Lucia", "LC"),
        ("Saint Vincent and the Grenadines", "VC"), ("Samoa", "WS"), ("San Marino", "SM"), ("Sao Tome and Principe", "ST"),
        ("Saudi Arabia", "SA"), ("Senegal", "SN"), ("Serbia", "RS"), ("Seychelles", "SC"), ("Sierra Leone", "SL"),
        ("Singapore", "SG"), ("Slovakia", "SK"), ("Slovenia", "SI"), ("Solomon Islands", "SB"), ("Somalia", "SO"),
        ("South Africa", "ZA"), ("South Korea", "KR"), ("South Sudan", "SS"), ("Spain", "ES"), ("Sri Lanka", "LK"),
        ("Sudan", "SD"), ("Suriname", "SR"), ("Sweden", "SE"), ("Switzerland", "CH"), ("Syria", "SY"), ("Taiwan", "TW"),
        ("Tajikistan", "TJ"), ("Tanzania", "TZ"), ("Thailand", "TH"), ("Timor-Leste", "TL"), ("Togo", "TG"), ("Tonga", "TO"),
        ("Trinidad and Tobago", "TT"), ("Tunisia", "TN"), ("Turkey", "TR"), ("Turkmenistan", "TM"), ("Tuvalu", "TV"),
        ("Uganda", "UG"), ("Ukraine", "UA"), ("United Arab Emirates", "AE"), ("United Kingdom", "GB"),
        ("United States", "US"), ("Uruguay", "UY"), ("Uzbekistan", "UZ"), ("Vanuatu", "VU"), ("Vatican City", "VA"),
        ("Venezuela", "VE"), ("Vietnam", "VN"), ("Yemen", "YE"), ("Zambia", "ZM"), ("Zimbabwe", "ZW"),
    };

    [Fact]
    public void Every_district_country_and_listed_country_has_a_currency()
    {
        // North Korea: its won has no published exchange rate, so it is left out on purpose.
        var missing = DistrictCountries.Concat(Countries.Select(c => c.Name)).Where(c => c != "North Korea" && CountryCurrency.Of(c) == null);
        Assert.Empty(missing);
    }

    [Fact]
    public void Currencies_agree_with_the_system_region_data()
    {
        // Newer than, or a choice different from, the operating system's data: euro in Bulgaria (2026) and Croatia (2023), the
        // Zimbabwe Gold, the new leone, dobra, ouguiya and bolivar, and the local currency beside the dollar or rand or rupee.
        var known = new HashSet<string> { "BG", "HR", "ZW", "SL", "ST", "MR", "VE", "PA", "LS", "BT", "HT", "SV", "CU", "PS", "BY", "TL", "NA", "SZ" };
        var wrong = new List<string>();
        var compared = 0;
        foreach (var (name, iso) in Countries.Where(c => !known.Contains(c.Iso) && c.Name != "North Korea"))
        {
            string region;
            try { region = new RegionInfo(iso).ISOCurrencySymbol; } catch (ArgumentException) { continue; }
            if (region.Length != 3 || region == "XXX") continue;
            compared++;
            if (CountryCurrency.Of(name) != region) wrong.Add($"{name}: {CountryCurrency.Of(name)} / {region}");
        }
        Assert.Empty(wrong);
        Assert.True(compared > 150, $"only {compared} countries compared");
    }

    [Fact]
    public void Every_currency_has_a_seed_rate() =>
        Assert.Empty(CountryCurrency.All.Where(c => !CurrencySeedRates.PerUsd.TryGetValue(c, out var r) || r <= 0));

    [Fact]
    public void Rupees_are_converted_not_counted_as_dollars()
    {
        var rates = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase) { ["USD"] = 1m, ["INR"] = 0.01m, ["EUR"] = 1.1m };
        Assert.Equal(100m, CurrencyHelper.Convert(10_000m, "INR", "USD", rates));
        Assert.Equal(10_000m, CurrencyHelper.Convert(100m, "USD", "INR", rates));
        Assert.Equal(11_000m, CurrencyHelper.Convert(100m, "EUR", "INR", rates));
        Assert.Equal(250m, CurrencyHelper.Convert(250m, null, "USD", rates)); // no code = the default currency
    }

    [Fact]
    public void Without_the_feed_the_dated_rates_are_used_never_one_to_one()
    {
        var rates = CurrencyRateService.Fallback;
        Assert.Equal(1m, rates["USD"]);
        Assert.InRange(CurrencyHelper.Convert(10_000m, "INR", "USD", rates), 80m, 140m);
        Assert.InRange(CurrencyHelper.Convert(100m, "GBP", "USD", rates), 100m, 180m);
    }

    [Fact]
    public void Amounts_print_in_their_own_currency()
    {
        Assert.Contains("1,234", Brand.Money(1234m, "JPY"));
        Assert.DoesNotContain(".00", Brand.Money(1234m, "JPY")); // yen has no decimals
        Assert.Equal("INR", CurrencyHelper.Normalize("inr"));
        Assert.Equal("INR", DuesCurrency.Normalize("INR"));
    }
}
