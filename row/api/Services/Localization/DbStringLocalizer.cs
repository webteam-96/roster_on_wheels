using System.Globalization;
using Microsoft.Extensions.Localization;

namespace RotaryApi.Services.Localization;

/// <summary>
/// S5: ASP.NET Core's IStringLocalizer over <see cref="ServerStrings"/> in place of .resx files (the owner rule is
/// machine translation, no hand-written resource files). The key is the English text ("keys are the default text"),
/// so a missing translation returns the key. The language is CultureInfo.CurrentUICulture, set per recipient with
/// <see cref="MessageCulture.Use"/>. One shared localizer for every type: the texts are not partitioned by class.
/// </summary>
public sealed class DbStringLocalizer : IStringLocalizer
{
    /// <summary>The shared instance, for code that is not built by DI (static helpers, jobs that new up services).</summary>
    public static readonly DbStringLocalizer Instance = new();

    public LocalizedString this[string name]
    {
        get
        {
            var t = ServerStrings.Find(CultureInfo.CurrentUICulture.Name, name);
            return new LocalizedString(name, t ?? name, resourceNotFound: t == null);
        }
    }

    public LocalizedString this[string name, params object[] arguments]
    {
        get
        {
            var s = this[name];
            try
            {
                return new LocalizedString(name, string.Format(CultureInfo.CurrentCulture, s.Value, arguments), s.ResourceNotFound);
            }
            catch (FormatException)
            {
                // a stored translation that does not format (SamePlaceholders guards new rows): the English text
                return new LocalizedString(name, string.Format(CultureInfo.CurrentCulture, name, arguments), true);
            }
        }
    }

    public IEnumerable<LocalizedString> GetAllStrings(bool includeParentCultures)
        => ServerStrings.All(CultureInfo.CurrentUICulture.Name).Select(p => new LocalizedString(p.Key, p.Value));
}

public sealed class DbStringLocalizerFactory : IStringLocalizerFactory
{
    public IStringLocalizer Create(Type resourceSource) => DbStringLocalizer.Instance;
    public IStringLocalizer Create(string baseName, string location) => DbStringLocalizer.Instance;
}
