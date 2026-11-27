namespace RotaryApi.Services;

/// <summary>Units of each currency per 1 US dollar on 25 November 2026 (open.er-api.com). Used only until the live feed
/// answers for the first time after a start; a dated rate is far closer than adding currencies up 1:1.</summary>
public static class CurrencySeedRates
{
    public static readonly DateTime AsOf = new(2026, 11, 25, 0, 0, 0, DateTimeKind.Utc);

    public static readonly IReadOnlyDictionary<string, decimal> PerUsd = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
    {
        ["AED"] = 3.6725m, ["AFN"] = 65.884112m, ["ALL"] = 82.063373m, ["AMD"] = 360.4212m, ["AOA"] = 932.007075m,
        ["ARS"] = 1592.0227m, ["AUD"] = 1.507265m, ["AWG"] = 1.79m, ["AZN"] = 1.698668m, ["BAM"] = 1.784621m,
        ["BBD"] = 2m, ["BDT"] = 124.682087m, ["BHD"] = 0.376m, ["BIF"] = 3008.778756m, ["BMD"] = 1m,
        ["BND"] = 1.289916m, ["BOB"] = 11.760928m, ["BRL"] = 5.894422m, ["BSD"] = 1m, ["BTN"] = 92.932086m,
        ["BWP"] = 14.657174m, ["BYN"] = 2.989306m, ["BZD"] = 2m, ["CAD"] = 1.429121m, ["CDF"] = 2299.591066m,
        ["CHF"] = 0.836724m, ["CLP"] = 1016.254496m, ["CNY"] = 6.678179m, ["COP"] = 3516.051988m,
        ["CRC"] = 446.591147m, ["CUP"] = 24m, ["CVE"] = 100.612638m, ["CZK"] = 22.279019m, ["DJF"] = 177.721m,
        ["DKK"] = 6.821344m, ["DOP"] = 59.692296m, ["DZD"] = 137.2423m, ["EGP"] = 54.225902m, ["ERN"] = 15m,
        ["ETB"] = 161.537273m, ["EUR"] = 0.91245m, ["FJD"] = 2.311279m, ["GBP"] = 0.763269m, ["GEL"] = 2.593613m,
        ["GHS"] = 11.877358m, ["GMD"] = 74.808817m, ["GNF"] = 8852.631733m, ["GTQ"] = 7.640445m, ["GYD"] = 209.128807m,
        ["HKD"] = 7.841855m, ["HNL"] = 26.88654m, ["HTG"] = 131.152842m, ["HUF"] = 337.292163m,
        ["IDR"] = 18227.123111m, ["ILS"] = 3.339784m, ["INR"] = 92.925233m, ["IQD"] = 1515.167081m,
        ["IRR"] = 1814738.061019m, ["ISK"] = 125.18669m, ["JMD"] = 158.428236m, ["JOD"] = 0.709m,
        ["JPY"] = 159.238818m, ["KES"] = 129.983516m, ["KGS"] = 87.459709m, ["KHR"] = 4067.116373m,
        ["KMF"] = 448.901944m, ["KRW"] = 1343.042517m, ["KWD"] = 0.31145m, ["KZT"] = 460.036521m,
        ["LAK"] = 22294.191288m, ["LBP"] = 89500m, ["LKR"] = 332.424303m, ["LRD"] = 166.061146m, ["LSL"] = 17.532707m,
        ["LYD"] = 6.463964m, ["MAD"] = 9.995204m, ["MDL"] = 18.289833m, ["MGA"] = 4589.243714m, ["MKD"] = 55.881655m,
        ["MMK"] = 2098.089139m, ["MNT"] = 3624.889904m, ["MOP"] = 8.077121m, ["MRU"] = 40.718625m,
        ["MUR"] = 47.013556m, ["MVR"] = 15.427621m, ["MWK"] = 1744.634554m, ["MXN"] = 19.375508m, ["MYR"] = 4.115504m,
        ["MZN"] = 63.70721m, ["NAD"] = 17.532707m, ["NGN"] = 1366.832855m, ["NIO"] = 36.725748m, ["NOK"] = 9.801644m,
        ["NPR"] = 148.691337m, ["NZD"] = 1.826291m, ["OMR"] = 0.384497m, ["PAB"] = 1m, ["PEN"] = 3.472691m,
        ["PGK"] = 4.525916m, ["PHP"] = 63.769743m, ["PKR"] = 276.39191m, ["PLN"] = 4.06987m, ["PYG"] = 6403.898532m,
        ["QAR"] = 3.64m, ["RON"] = 4.873667m, ["RSD"] = 107.381796m, ["RUB"] = 81.96636m, ["RWF"] = 1481.829676m,
        ["SAR"] = 3.75m, ["SBD"] = 8.046786m, ["SCR"] = 14.204537m, ["SDG"] = 449.713363m, ["SEK"] = 10.240617m,
        ["SGD"] = 1.28993m, ["SLE"] = 22.929351m, ["SOS"] = 571.336697m, ["SRD"] = 37.502791m, ["SSP"] = 5753.461873m,
        ["STN"] = 22.355322m, ["SYP"] = 121.533692m, ["SZL"] = 17.532707m, ["THB"] = 33.940118m, ["TJS"] = 9.223002m,
        ["TMT"] = 3.499942m, ["TND"] = 3.058457m, ["TOP"] = 2.412167m, ["TRY"] = 50.669245m, ["TTD"] = 6.755945m,
        ["TWD"] = 32.918193m, ["TZS"] = 2668.414979m, ["UAH"] = 45.326038m, ["UGX"] = 4085.836012m, ["USD"] = 1m,
        ["UYU"] = 40.532358m, ["UZS"] = 11969.947293m, ["VES"] = 922.5637m, ["VND"] = 25765.93616m,
        ["VUV"] = 120.975647m, ["WST"] = 2.794555m, ["XAF"] = 598.535926m, ["XCD"] = 2.7m, ["XOF"] = 598.535926m,
        ["XPF"] = 108.885932m, ["YER"] = 236.256919m, ["ZAR"] = 17.532655m, ["ZMW"] = 20.765661m, ["ZWG"] = 26.5213m,
    };
}
