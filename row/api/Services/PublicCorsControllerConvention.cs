using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationModels;

namespace RotaryApi.Services;

// Applies the open "PublicOpen" CORS policy to ONLY the CLUB-WEBSITE public controllers, so the React
// club websites (served from ~1000 un-enumerable domains) can call them from the browser. Deliberately
// scoped — it does NOT touch the mobile API, the admin web API, or the other api/public/* endpoints
// (pay links, directory, project-stats, dues, wallet), which keep the strict default CORS policy.
public sealed class PublicCorsControllerConvention : IControllerModelConvention
{
    // Exact route templates that belong to the club website only.
    //   api/public/club          → ClubWebsitePublicData (v1/v2) + ClubGalleryPublic (the site's feed)
    //   api/public/club-website  → ClubWebsitePublicController (by-host / renew-link resolver)
    // NB: matched by exact segment so "api/public/club-dues" (a WEB pay endpoint) is NOT included.
    private static readonly string[] ClubWebsiteRoutes =
    {
        "api/public/club",
        "api/public/club-website",
    };

    public void Apply(ControllerModel controller)
    {
        bool isClubWebsite = controller.Attributes
            .OfType<RouteAttribute>()
            .Any(r => r.Template != null && ClubWebsiteRoutes.Any(t =>
                string.Equals(r.Template, t, StringComparison.OrdinalIgnoreCase) ||
                r.Template.StartsWith(t + "/", StringComparison.OrdinalIgnoreCase)));
        if (!isClubWebsite) return;

        foreach (var selector in controller.Selectors)
            selector.EndpointMetadata.Add(new EnableCorsAttribute("PublicOpen"));
    }
}
