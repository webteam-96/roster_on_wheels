using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using RotaryApi.Services;

// The host web root is locked once the builder is created, so read the optional
// "Media:WebRoot" override up-front and pass it through WebApplicationOptions (changing it
// later via builder.WebHost is not supported). When set (production) uploads write there and
// it backs the static file root — e.g. the legacy example.org httpdocs holding every
// migrated photo. Unset locally → default wwwroot.
var bootCfg = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: true)
    .AddJsonFile($"appsettings.{Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production"}.json", optional: true)
    .AddEnvironmentVariables()
    .Build();
var mediaWebRoot = bootCfg["Media:WebRoot"];

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = (!string.IsNullOrWhiteSpace(mediaWebRoot) && Directory.Exists(mediaWebRoot)) ? mediaWebRoot : null
});

// Instance brand (product name, domains, contacts) from the "Brand" section; see Services/Brand.cs.
RotaryApi.Services.Brand.Init(builder.Configuration);

// Add services to the container. The convention opens CORS (PublicOpen policy) on every controller
// routed under api/public — see PublicCorsControllerConvention.
// Per-IP limit for the public sign-in endpoints marked [EnableRateLimiting("auth")]: 10 a minute.
// Partitions by the client IP. Behind a reverse proxy, list the proxy's networks in ForwardedHeaders:KnownNetworks
// (CIDR, e.g. ForwardedHeaders__KnownNetworks__0=10.0.0.0/16) so X-Forwarded-For is trusted; loopback is trusted by default.
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    foreach (var cidr in builder.Configuration.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>() ?? [])
        o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(cidr));
});
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
    // Public forms anyone can post (volunteer sign-up link): 10 posts per IP per 10 minutes.
    o.AddPolicy("public-form", ctx => System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(10) }));
    // Public join and RSVP forms (PublicJoinController): 8 posts per 10 minutes per IP.
    o.AddPolicy("join-form", ctx => System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions { PermitLimit = 8, Window = TimeSpan.FromMinutes(10) }));
    // Anonymous calendar feeds (MeetingsController, [EnableRateLimiting("feed")]): calendar apps poll every few minutes at most.
    o.AddPolicy("feed", ctx => System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1) }));
    // Public unsubscribe page and one-click requests (CommsController, [EnableRateLimiting("unsubscribe")]).
    o.AddPolicy("unsubscribe", ctx => System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
    // Public reads marked [EnableRateLimiting("public-read")]: 600 a minute per IP. Over the limit a site shows its default language.
    // shortcut: the public sites call from their server, so one site server shares one bucket; partition by the visitor IP
    // the site forwards once sites run behind a shared server at real load.
    o.AddPolicy("public-read", ctx => System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.AddControllers(o =>
    {
        o.Conventions.Add(new RotaryApi.Services.PublicCorsControllerConvention());
        // Every uploaded photo is re-saved at 2560 px / JPEG 88 before the action sees it (D: disk space).
        o.Filters.Add<RotaryApi.Services.PhotoUploadOptimizeFilter>();
    })
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        // ROW: blood group and family details are left out of every response while their flags are off.
        RotaryApi.Privacy.MemberDataGuard.Apply(options.JsonSerializerOptions);
        // ROW: timestamps carry "Z" when the server runs in UTC (time.emitOffset); see UtcDateTimeConverter.
        options.JsonSerializerOptions.Converters.Add(new RotaryApi.Services.UtcDateTimeConverter());
    });

// ── Upload size limits (project rule: 5 MB photos / 20 MB documents stored,
// 50 MB hard cap on the wire). The browser-side validator in
// lib/uploadValidate.ts compresses oversized images to ≤ 5 MB, accepts
// documents up to 20 MB, and rejects anything > 50 MB before upload. Server
// caps allow up to ~55 MB so the frontend's 50 MB ceiling has multipart
// envelope room without false 413s. Same value applied to:
//   - Kestrel  (when running standalone in dev)
//   - IIS      (when hosted under iisnode/AspNetCoreModule in production)
//   - Form     (per-form body limit — used for IFormFile binding)
const long MaxRequestBodyBytes = 55L * 1024 * 1024;
builder.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MaxRequestBodySize = MaxRequestBodyBytes;
});
builder.Services.Configure<Microsoft.AspNetCore.Builder.IISServerOptions>(o =>
{
    o.MaxRequestBodySize = MaxRequestBodyBytes;
});
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = MaxRequestBodyBytes;
    o.ValueLengthLimit = int.MaxValue;
    o.MemoryBufferThreshold = int.MaxValue;
});

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (builder.Environment.IsDevelopment())
        {
            policy.AllowAnyOrigin()
                  .AllowAnyHeader()
                  .AllowAnyMethod();
        }
        else
        {
            // Allow the main API host AND every subdomain of the club/district website
            // parent domains. District directories live at {districtNumber}club.example.org,
            // club websites at {clubSubdomain}.portal.example.org, etc. — too many to hard-code,
            // so we accept any host that ends with one of these parents.
            //
            // localhost / 127.0.0.1 (any port) is also allowed so the web team can develop
            // locally against the live API. This is an internal-team trade-off — anyone
            // running a browser page at localhost can call the production API. Remove these
            // two lines if you want production-only origins.
            policy.SetIsOriginAllowed(origin =>
                  {
                      if (string.IsNullOrEmpty(origin)) return false;
                      if (!Uri.TryCreate(origin, UriKind.Absolute, out var u)) return false;
                      if (u.Scheme != "https" && u.Scheme != "http") return false;
                      var host = u.Host.ToLowerInvariant();
                      return RotaryApi.Services.Brand.IsOwnHost(host)
                          || host == "localhost"
                          || host == "127.0.0.1";
                  })
                  .AllowAnyHeader()
                  .AllowAnyMethod();
        }
    });

    // Open policy for anonymous public API routes (browser-called from the ~1000 club/district
    // website domains — plus custom per-club domains — that can never be enumerated in an allow-list).
    // Applied to every controller routed under api/public by PublicCorsControllerConvention. These are
    // [AllowAnonymous] read-only endpoints, so this loses no protection. No credentials (AllowAnyOrigin).
    options.AddPolicy("PublicOpen", p => p
        .AllowAnyOrigin()
        .AllowAnyHeader()
        .AllowAnyMethod());

});

// JWT Authentication
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var secretKey = Encoding.UTF8.GetBytes(jwtSettings["Secret"]!);

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.MapInboundClaims = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtSettings["Issuer"],
        ValidAudience = jwtSettings["Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(secretKey)
    };
    // The chat hub's clients send the token in the access_token query (a browser WebSocket cannot carry headers).
    // Accepted on that path only; the error log below leaves such query strings out.
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = ctx =>
        {
            if (string.IsNullOrEmpty(ctx.Token) && ctx.HttpContext.Request.Path.StartsWithSegments("/api/chat/hub"))
                ctx.Token = ctx.Request.Query["access_token"];
            return Task.CompletedTask;
        }
    };
});

builder.Services.AddAuthorization();
builder.Services.AddResponseCaching();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo { Title = "ROW API", Version = "v1" });
    // Use controller+action to make operationId unique across duplicate method names
    c.CustomOperationIds(api =>
    {
        var controller = api.ActionDescriptor.RouteValues.TryGetValue("controller", out var cn) ? cn : "Unknown";
        var action = api.ActionDescriptor.RouteValues.TryGetValue("action", out var an) ? an : "Unknown";
        return $"{controller}_{action}";
    });
    // Resolve route conflicts by picking the first matching action
    c.ResolveConflictingActions(apiDescriptions => apiDescriptions.First());
    // Use full type name for schema IDs so nested types with the same short name
    // (e.g. two controllers each with their own `CreateRequest`) don't collide.
    c.CustomSchemaIds(type => type.FullName?.Replace("+", ".") ?? type.Name);
    c.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Description = "Enter JWT token: Bearer {token}",
        Name = "Authorization",
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        { new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            { Reference = new Microsoft.OpenApi.Models.OpenApiReference { Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme, Id = "Bearer" } },
          Array.Empty<string>() }
    });
});

builder.Services.AddSingleton<DatabaseInitializer>();
// ROW privacy (master plan WS7): consent, export, erasure, retention. Behind Brand:Features:privacy.enabled.
builder.Services.AddSingleton<RotaryApi.Privacy.PrivacyService>();
builder.Services.AddMemoryCache();

// Club-website cache purger — fires fire-and-forget HTTP calls to club-website's
// /api/purge-cache route whenever admin saves a change that affects public rendering.
builder.Services.AddHttpClient();
builder.Services.AddSingleton<IClubSiteCachePurger, ClubSiteCachePurger>();
builder.Services.AddSingleton<IIisAppPoolRecycler, IisAppPoolRecycler>();

// Rotary.org sync client — HttpClient is pooled; the client itself holds a process-scoped token cache.
builder.Services.AddHttpClient<RotaryApi.Services.RotaryOrg.IRotaryOrgApiClient, RotaryApi.Services.RotaryOrg.RotaryOrgApiClient>();
builder.Services.AddSingleton<RotaryApi.Services.RotaryOrg.IClubSyncService, RotaryApi.Services.RotaryOrg.ClubSyncService>();
// Shared /clubs cache refresh (used by the manual button + the auto scheduler below).
builder.Services.AddScoped<RotaryApi.Services.RotaryOrg.IClubCacheRefreshService, RotaryApi.Services.RotaryOrg.ClubCacheRefreshService>();

builder.Services.AddScoped<IMemberService, MemberService>();
builder.Services.AddScoped<ICountryService, CountryService>();
builder.Services.AddScoped<IEmailService, EmailService>();
builder.Services.AddScoped<IRoleService, RoleService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IZoneService, ZoneService>();
builder.Services.AddScoped<IDistrictService, DistrictService>();
builder.Services.AddScoped<IClubService, ClubService>();
builder.Services.AddScoped<IModuleService, ModuleService>();
builder.Services.AddScoped<IRotaryYearService, RotaryYearService>();
builder.Services.AddSingleton<IYearTableResolver, YearTableResolver>();
// One definition of "a project that counts", shared by the public projects API and the
// daily statistics email so the two can never publish different totals.
builder.Services.AddSingleton<IProjectCountRules, ProjectCountRules>();
builder.Services.AddSingleton<ICurrencyRateService, CurrencyRateService>();
builder.Services.AddScoped<IAgDashboardService, AgDashboardService>();
builder.Services.AddScoped<IClubAdminDashboardService, ClubAdminDashboardService>();
builder.Services.AddScoped<IFoundationGoalsService, FoundationGoalsService>();
builder.Services.AddScoped<IGoalSettingService, GoalSettingService>();
builder.Services.AddScoped<IDistrictAdminDashboardService, DistrictAdminDashboardService>();
// Singleton: owns the start-lock + orchestrates detached background refresh tasks across the
// app's lifetime, independent of any single HTTP request's scope.
builder.Services.AddSingleton<IDistrictRotaryRefreshJobRunner, DistrictRotaryRefreshJobRunner>();
// Read-only builder for the mobile membership-dues payment receipt (PDF/JSON).
// Separate from IMembershipDuesService on purpose: SELECT-only, no e-mail, no
// state change — see DuesReceiptService for the ownership rules.
builder.Services.AddScoped<IDuesReceiptService, DuesReceiptService>();
builder.Services.AddScoped<IPastPresidentService, PastPresidentService>();
builder.Services.AddScoped<IDesignationService, DesignationService>();
builder.Services.AddScoped<IBoardDirectorService, BoardDirectorService>();
builder.Services.AddScoped<IDcAutoGroupService, DcAutoGroupService>();
builder.Services.AddScoped<IBodSubGroupAutoService, BodSubGroupAutoService>();
// Note: nightly rebuild runs as RotaryOrgSyncWorker --bod-subgroup-sync (Task Scheduler).
// The API service above is kept for real-time hooks when BOD changes via web portal.
builder.Services.AddScoped<IWebsiteDataModuleService, WebsiteDataModuleService>();
builder.Services.AddScoped<IThemeService, ThemeService>();
builder.Services.AddScoped<IWebsiteLanguageService, WebsiteLanguageService>();
// Chat (build spec 3.10): REST in ChatController, real-time delivery through SignalR (shared framework, no package).
// shortcut: SignalR delivers to clients connected to this API instance only; add a backplane (Redis) when the API
// runs on more than one instance.
builder.Services.AddSignalR().AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new UtcDateTimeConverter()));
builder.Services.AddSingleton<Microsoft.AspNetCore.SignalR.IUserIdProvider, ChatUserIdProvider>();
builder.Services.AddScoped<IChatService, ChatService>();
builder.Services.AddScoped<IClubThemeService, ClubThemeService>();
builder.Services.AddScoped<IClubBannerService, ClubBannerService>();
builder.Services.AddScoped<IClubAdvertisementService, ClubAdvertisementService>();
builder.Services.AddScoped<IClubSocialLinkService, ClubSocialLinkService>();
builder.Services.AddScoped<IClubMenuService, ClubMenuService>();
builder.Services.AddScoped<IClubContactDetailService, ClubContactDetailService>();
builder.Services.AddScoped<IClubAboutService, ClubAboutService>();
builder.Services.AddScoped<IPotentialMemberService, PotentialMemberService>();
// N3 contacts, prospects, growth, invite prompts (feature contacts_growth)
builder.Services.AddScoped<ContactService>();
builder.Services.AddScoped<GrowthService>();
builder.Services.AddScoped<InvitePromptService>();
// N10 live target dashboard (feature target_dashboard)
builder.Services.AddScoped<TargetDashboardService>();
// Escalation ladder (flag escalation) and target celebration (flag celebration); the daily passes are registered below.
builder.Services.AddScoped<EscalationService>();
builder.Services.AddScoped<CelebrationService>();
builder.Services.AddScoped<IAreaOfFocusService, AreaOfFocusService>();
builder.Services.AddScoped<IFundingService, FundingService>();
builder.Services.AddScoped<IProjectService, ProjectService>();
builder.Services.AddScoped<IUpcomingEventService, UpcomingEventService>();
builder.Services.AddScoped<IAnnouncementService, AnnouncementService>();
builder.Services.AddScoped<INewsletterService, NewsletterService>();
builder.Services.AddScoped<IDocumentService, DocumentService>();
builder.Services.AddScoped<IRouteMaintenanceService, RouteMaintenanceService>();
builder.Services.AddScoped<IGreetingService, GreetingService>();
// Mobile bell-icon feed (GET /api/mobile/notifications)
builder.Services.AddScoped<IMobileNotificationFeedService, MobileNotificationFeedService>();
// Engagement: milestones, PHF highlights, spotlight cards (flag engagement); the daily pass is registered below.
builder.Services.AddScoped<EngagementService>();
builder.Services.AddScoped<IAttendanceService, AttendanceService>();
// N8 Meetings: calendar feeds, compliance, reminder text (MeetingReminderBackgroundService sends the emails)
builder.Services.AddScoped<MeetingsService>();
// N5 Communication: templates, sender domains, allowances, suppressions, consent, tracking (CommsController)
builder.Services.AddScoped<CommsService>();
builder.Services.AddScoped<IClubMonthlyReportService, ClubMonthlyReportService>();
builder.Services.AddScoped<IDistrictCmrEmailSettingsService, DistrictCmrEmailSettingsService>();
builder.Services.AddScoped<ICmrSubmissionMailer, CmrSubmissionMailer>();
builder.Services.AddScoped<IDailyStatsReportService, DailyStatsReportService>();
builder.Services.AddHostedService<DailyStatsReportBackgroundService>();
// District Performance Report (DG progress report) — schedule OFF unless DistrictPerformanceReport:Enabled=true.
builder.Services.AddScoped<IDistrictPerformanceReportService, DistrictPerformanceReportService>();
builder.Services.AddHostedService<DistrictPerformanceReportBackgroundService>();
builder.Services.AddScoped<IOcvGovService, OcvGovService>();
builder.Services.AddScoped<ITrfContributionService, TrfContributionService>();
builder.Services.AddScoped<ICashfreeKycService, CashfreeKycService>();
builder.Services.AddScoped<IWeblinkService, WeblinkService>();
builder.Services.AddScoped<ISubGroupService, SubGroupService>();
builder.Services.AddScoped<IEventPaymentLinkService, EventPaymentLinkService>();
builder.Services.AddScoped<IMembershipDuesService, MembershipDuesService>();
builder.Services.AddScoped<IClubDuesService, ClubDuesService>();
builder.Services.AddSingleton<IGoogleSheetsService, GoogleSheetsService>();
builder.Services.AddScoped<ICreditManagementService, CreditManagementService>();
builder.Services.AddScoped<IWalletService, WalletService>();
builder.Services.AddScoped<IClubWebsiteActivationService, ClubWebsiteActivationService>();
builder.Services.AddScoped<IWebsiteBillingService, WebsiteBillingService>();
builder.Services.AddScoped<IRazorpayRouteService, RazorpayRouteService>();
builder.Services.AddScoped<IRazorpaySettlementService, RazorpaySettlementService>();
builder.Services.AddScoped<IWalletReportService, WalletReportService>();
// Website provisioning runs UNCONDITIONALLY (payment-critical): it only acts on already-PAID
// orders, so it is safe even with BackgroundJobs:Enabled=false locally.
builder.Services.AddHostedService<WebsiteProvisioningBackgroundService>();
builder.Services.AddSingleton<IZoomMeetingService, ZoomMeetingService>();
builder.Services.AddScoped<ITrainingAppointmentService, TrainingAppointmentService>();
builder.Services.AddScoped<IClubMassEmailService, ClubMassEmailService>();

// Background jobs (email/push senders + auto-calc) run automatically on startup and act on
// live DB data. Set "BackgroundJobs:Enabled": false in local appsettings so running against production
// data (e.g. claude1) does NOT fire real emails/push. Defaults to true (servers).
var enableBackgroundJobs = builder.Configuration.GetValue<bool>("BackgroundJobs:Enabled", true);

if (enableBackgroundJobs) builder.Services.AddHostedService<CreditExpiryBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<RotaryApi.Privacy.PrivacyRetentionBackgroundService>();
builder.Services.AddSingleton<CitationAutoPointsBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService(sp => sp.GetRequiredService<CitationAutoPointsBackgroundService>());
// Fire-and-forget trigger callable from any write-side service to recompute
// a club's auto-points immediately after a citation-relevant change.
builder.Services.AddSingleton<ICitationRecalcTrigger, CitationRecalcTrigger>();
builder.Services.AddScoped<IMobileAuthService, MobileAuthService>();
builder.Services.AddScoped<IClubRotaryOrgCredentialService, ClubRotaryOrgCredentialService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<EmailScheduledSendBackgroundService>();
builder.Services.AddScoped<TenantRenewalService>(); // build spec 3.5 renewal reminders
// S5 (build spec 3.3, 3.16): server texts through ASP.NET Core localization, translations kept in server_strings.
builder.Services.AddLocalization();
builder.Services.AddSingleton<Microsoft.Extensions.Localization.IStringLocalizerFactory, RotaryApi.Services.Localization.DbStringLocalizerFactory>();
var translationProvider = RotaryApi.Services.Localization.StringTranslationBackgroundService.Provider(builder.Configuration);
RotaryApi.Services.Localization.ServerStrings.QueueEnabled = translationProvider != "none";
if (translationProvider != "none") builder.Services.AddHostedService<RotaryApi.Services.Localization.StringTranslationBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<TenantRenewalBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<ClubLeadershipEmailBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<ClubWebsiteReminderBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<EngagementBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<TargetAlertsBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<InvitePromptBackgroundService>();
// Meeting reminder emails follow BackgroundJobs:Enabled unless Meetings:ReminderJob says otherwise (ops switch);
// they also wait for the 'meetings' feature to be on.
if (builder.Configuration.GetValue("Meetings:ReminderJob", enableBackgroundJobs)) builder.Services.AddHostedService<MeetingReminderBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<RotaryYearRolloverBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<RazorpaySettlementSyncBackgroundService>();
// Cashfree dues reconciliation — safety net for webhooks that never arrive.
// Additionally gated by MembershipDuesReconciliation:Enabled (default false), so it is
// safe to deploy switched off and turn on from appsettings without a code change.
if (enableBackgroundJobs) builder.Services.AddHostedService<MembershipDuesReconciliationBackgroundService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<RotaryApi.Services.RotaryOrg.ClubCacheRefreshBackgroundService>();

// Firebase push notifications (announcement)
builder.Services.AddSingleton<RotaryApi.Services.Push.IFirebasePushService, RotaryApi.Services.Push.FirebasePushService>();
if (enableBackgroundJobs)
{
    builder.Services.AddHostedService<RotaryApi.Services.Push.AnnouncementPushBackgroundService>();
    builder.Services.AddHostedService<RotaryApi.Services.Push.EventPushBackgroundService>();
    builder.Services.AddHostedService<RotaryApi.Services.Push.DocumentPushBackgroundService>();
    builder.Services.AddHostedService<RotaryApi.Services.Push.NewsletterPushBackgroundService>();
    builder.Services.AddHostedService<RotaryApi.Services.Push.ProjectPushBackgroundService>();
    builder.Services.AddHostedService<RotaryApi.Services.Push.ReminderPushBackgroundService>();
    builder.Services.AddHostedService<RotaryApi.Services.Push.PushLogCleanupBackgroundService>();
}

// Grants (ROW build spec 3.8): service + the job that emails grant notifications.
builder.Services.AddScoped<GrantService>();
if (enableBackgroundJobs) builder.Services.AddHostedService<GrantNotificationEmailBackgroundService>();

// Volunteers and speakers (ROW build spec 3.13). VolunteerReminders:Enabled runs the reminder job alone on a dev copy
// (BackgroundJobs:Enabled would start every job against that data).
builder.Services.AddScoped<VolunteerService>();
builder.Services.AddScoped<SpeakerService>();
if (enableBackgroundJobs || builder.Configuration.GetValue<bool>("VolunteerReminders:Enabled"))
    builder.Services.AddHostedService<VolunteerReminderBackgroundService>();

// Planning mode and cut-over (ROW build spec 3.1): service + the job that runs scheduled cut-overs
// (Planning:CutoverJob runs that job alone on a dev copy, like Meetings:ReminderJob).
builder.Services.AddScoped<PlanningService>();
if (builder.Configuration.GetValue("Planning:CutoverJob", enableBackgroundJobs))
    builder.Services.AddHostedService<PlanningCutoverBackgroundService>();

builder.Services.AddSingleton<PleskService>();
builder.Services.AddSingleton<IDnsPointingChecker, DnsPointingChecker>();
builder.Services.AddHttpClient();

// Encrypts/decrypts club_rotary_org_credentials at rest (RI Flow-Bot per-club logins).
// Explicit file-system key persistence, same App_Data/ folder as firebase-admin.json —
// default key-ring heuristics aren't reliable for an IIS app-pool identity.
builder.Services.AddDataProtection()
    .SetApplicationName("RotaryApi")
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(builder.Environment.ContentRootPath, "App_Data", "dp-keys")));

var app = builder.Build();
app.UseForwardedHeaders(); // first, so the rate limiter, audit log and HTTPS checks see the real client

// Startup banner — tells the morning admin which background services are
// armed without having to grep the codebase. Visible in stdout / Plesk log
// the moment the API binds its port.
app.Logger.LogInformation(
    "═══ RotaryApi startup ═══ BackgroundJobs.Enabled={Bg} | CitationAutoPoints.DailyLoopEnabled={Cite}",
    enableBackgroundJobs,
    builder.Configuration.GetValue<bool>("CitationAutoPoints:DailyLoopEnabled"));

// Initialize database — gated by config so local dev can skip the ~900-DDL
// initializer when schema is already up to date. Production never sets the
// flag so startup behavior there is unchanged.
var skipInit = builder.Configuration.GetValue<bool>("Database:SkipInit");
if (!skipInit)
{
    var dbInitializer = app.Services.GetRequiredService<DatabaseInitializer>();
    await dbInitializer.InitializeAsync();
}
else
{
    app.Logger.LogInformation("DatabaseInitializer SKIPPED (Database:SkipInit = true). Toggle off in appsettings if you add new tables/columns.");
}
// S5: the stored server-text translations, held in memory (English only if the table is not there yet).
try
{
    await using var stringsConn = new MySqlConnector.MySqlConnection(builder.Configuration.GetConnectionString("DefaultConnection"));
    await RotaryApi.Services.Localization.ServerStrings.LoadAsync(stringsConn);
}
catch (Exception ex) { app.Logger.LogWarning("server strings not loaded: {Message}", ex.Message); }
// ROW privacy tables: the consent filter in the email and push senders reads member_consents (WS7-05).
if (RotaryApi.Privacy.PrivacyService.Enabled)
{
    try
    {
        await using var privacyConn = new MySqlConnector.MySqlConnection(builder.Configuration.GetConnectionString("DefaultConnection"));
        await privacyConn.OpenAsync();
        await RotaryApi.Privacy.PrivacyService.EnsureTablesAsync(privacyConn);
    }
    catch (Exception ex) { app.Logger.LogWarning("privacy tables not ensured: {Message}", ex.Message); }
}

// Goal-setting metadata (the 4 tabs + all fields + the IsHidden/AppliesTo columns) is applied on
// EVERY startup, independent of SkipInit — the seed is idempotent and cheap, so schema/seed changes
// to the goal system take effect on the next restart without a full initializer run. Guarded so a
// failure here can't stop the host from coming up.
try
{
    var goalInit = app.Services.GetRequiredService<DatabaseInitializer>();
    await goalInit.EnsureGoalSettingSchemaAndSeedAsync();
    app.Logger.LogInformation("Goal-setting schema + seed ensured.");
}
catch (Exception ex)
{
    app.Logger.LogError(ex, "Goal-setting schema/seed ensure failed.");
}

// One-time backfill of auto-managed CP/CS groups in District Committee from existing BOD rows.
// Idempotent — safe to run on every startup. Creates groups for ALL years that have BOD entries,
// plus current-year empty groups in every district.
// Runs in the BACKGROUND (fire-and-forget) so it does NOT block the web host from binding its port.
// On a large DB the scan over all districts' BOD CP/CS rows can take a while; the API must come up promptly.
// ON HOLD (user 2026-09-16): the startup CP/CS merge / backfill / clean-up does NOT run on restart unless
// "DcAutoGroups:RunStartupCleanup": true is set in appsettings. BOD add/edit/delete still update DC live.
if (app.Configuration.GetValue<bool>("DcAutoGroups:RunStartupCleanup"))
_ = Task.Run(async () =>
{
    using var bfScope = app.Services.CreateScope();
    var dcAuto = bfScope.ServiceProvider.GetRequiredService<IDcAutoGroupService>();
    var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();

    // Migrate + backfill — guarded on their own so a failure here can't skip the collapse below.
    try
    {
        // Idempotent migration: rename historic singular groups ("Club President" → "Club Presidents")
        // and move their members. Must run BEFORE backfill so EnsureGroupAsync doesn't recreate a singular row.
        var (migratedGroups, movedMembers) = await dcAuto.MigrateSingularToPluralAsync();
        if (migratedGroups > 0 || movedMembers > 0)
            startupLogger.LogInformation("DC CP/CS plural migration: groups migrated = {G}, members moved = {M}", migratedGroups, movedMembers);
        var (groupsCreated, membersAdded) = await dcAuto.BackfillAsync();
        if (groupsCreated > 0 || membersAdded > 0)
            startupLogger.LogInformation("DC auto-group backfill: groups created = {G}, members added = {M}", groupsCreated, membersAdded);
    }
    catch (Exception ex)
    {
        startupLogger.LogError(ex, "DC auto-group migrate/backfill failed (non-fatal)");
    }

    // ALWAYS run the one-per-club collapse — in its OWN guard so a migrate/backfill failure never skips it.
    // Enforces one CP + one CS per club and removes NULL-club orphan rows, across every district & year.
    // Idempotent — safe on every startup.
    try
    {
        var collapsed = await dcAuto.CollapseAutoGroupsToOnePerClubAsync();
        if (collapsed > 0)
            startupLogger.LogInformation("DC one-per-club collapse: {N} duplicate/orphan CP/CS group rows removed", collapsed);
    }
    catch (Exception ex)
    {
        startupLogger.LogError(ex, "DC one-per-club collapse failed (non-fatal)");
    }
});

// One-time backfill: legacy e-bulletin (newsletter) files uploaded BEFORE filenames were sanitized
// (commit 0e2c3983) kept their spaces on disk AND in the DB FilePath (e.g. "RC Pulse 05 4-8-26_...pdf").
// The served URL encodes those spaces as '+', and IIS blocks '+' in the request PATH (request filtering)
// → the PDF 404s in email/browser even though it physically exists. Rename each such file to a
// servable name (same rule as NewsletterService.UploadFileAsync) on disk AND update its DB FilePath, so
// no space/'+' is ever produced again. This is the ONLY reliable fix — a serve-time rewrite can't help
// because IIS rejects the '+' before the request reaches the app. Idempotent: only rows whose FilePath
// still contains a non-servable char are touched, and each file is moved only when the clean name is free.
_ = Task.Run(async () =>
{
    var bfLog = app.Services.GetRequiredService<ILogger<Program>>();
    try
    {
        var webRoot = app.Environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
        using var bfScope = app.Services.CreateScope();
        var connStr = bfScope.ServiceProvider.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")!;
        await using var conn = new MySqlConnector.MySqlConnection(connStr);
        await conn.OpenAsync();
        // Filename-only rows (skip already-absolute '/...' legacy paths) whose name has any char other
        // than letters/digits/dot/underscore/hyphen — i.e. spaces, '+', parentheses, etc.
        var rows = (await Dapper.SqlMapper.QueryAsync(conn, @"
            SELECT pk_newsletter_id AS Id,
                   fk_club_id AS ClubId, fk_district_id AS DistrictId, FilePath
            FROM newsletters
            WHERE FilePath IS NOT NULL AND FilePath <> ''
              AND FilePath NOT LIKE '/%'
              AND FilePath REGEXP '[^A-Za-z0-9._-]'")).ToList();
        int renamed = 0, skipped = 0;
        foreach (var r in rows)
        {
            try
            {
                string oldName = (string)r.FilePath;
                int clubId = r.ClubId != null ? Convert.ToInt32(r.ClubId) : 0;
                int distId = r.DistrictId != null ? Convert.ToInt32(r.DistrictId) : 0;
                // group folder mirrors the read-SQL CONCAT: Group{district} | Group{club}
                string folder = distId > 0 ? $"Group{distId}" : $"Group{clubId}";
                var dir = Path.Combine(webRoot, "Documents", "ebulletin", folder);
                var ext = Path.GetExtension(oldName);
                var baseName = Path.GetFileNameWithoutExtension(oldName);
                var cleanBase = System.Text.RegularExpressions.Regex.Replace(baseName, @"[^A-Za-z0-9\-]+", "_").Trim('_');
                if (string.IsNullOrEmpty(cleanBase)) cleanBase = "file";
                var newName = cleanBase + ext;
                if (newName == oldName) continue;
                var oldPath = Path.Combine(dir, oldName);
                var newPath = Path.Combine(dir, newName);
                bool haveNew = System.IO.File.Exists(newPath);
                if (!haveNew && System.IO.File.Exists(oldPath)) { System.IO.File.Move(oldPath, newPath); haveNew = true; }
                if (haveNew) // only re-point the DB when a servable file actually exists under the clean name
                {
                    await Dapper.SqlMapper.ExecuteAsync(conn,
                        "UPDATE newsletters SET FilePath=@New WHERE pk_newsletter_id=@Id",
                        new { New = newName, Id = (int)r.Id });
                    renamed++;
                }
                else { skipped++; }
            }
            catch (Exception exRow)
            {
                bfLog.LogWarning(exRow, "e-bulletin filename backfill: could not fix newsletter {Id}", (int)r.Id);
            }
        }
        if (renamed > 0 || skipped > 0)
            bfLog.LogInformation("e-bulletin filename backfill: sanitized {N} legacy newsletter filenames (disk + DB); {S} skipped (file missing under clean name)", renamed, skipped);
    }
    catch (Exception ex)
    {
        bfLog.LogError(ex, "e-bulletin filename backfill failed (non-fatal)");
    }
});

// Pre-create upload folders. With a shared/cross-vhost web root (Media:WebRoot) the app-pool
// identity may lack create rights here — don't let that crash startup. Upload code re-creates
// the folder it needs on demand, and existing folders (e.g. migrated Documents/gallery) need
// no write access. A permission/path problem is logged as a warning instead.
try
{
    var webRoot = app.Environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
    var uploadsPath = Path.Combine(webRoot, "uploads");
    Directory.CreateDirectory(uploadsPath);
    Directory.CreateDirectory(Path.Combine(uploadsPath, "district"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "club"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "theme"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "banner"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "advertisement"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "menu"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "about"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "project"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "area-of-focus"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "event"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "announcement"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "newsletter"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "document"));
    Directory.CreateDirectory(Path.Combine(uploadsPath, "mass-email"));
    // Documents/gallery for project photos
    Directory.CreateDirectory(Path.Combine(webRoot, "Documents", "gallery"));
    // tempdocument for temporary photo uploads before project creation
    Directory.CreateDirectory(Path.Combine(webRoot, "tempdocument"));
    // OCV documents directory
    Directory.CreateDirectory(Path.Combine(webRoot, "Documents", "OCV"));
    // Weblink documents directory
    Directory.CreateDirectory(Path.Combine(webRoot, "Documents", "Weblink"));
    // Event payment link uploads
    var eventPayPath = Path.Combine(webRoot, "uploads", "event-payment");
    Directory.CreateDirectory(eventPayPath);
    Directory.CreateDirectory(Path.Combine(eventPayPath, "logos"));
    Directory.CreateDirectory(Path.Combine(eventPayPath, "images"));
    Directory.CreateDirectory(Path.Combine(eventPayPath, "backgrounds"));
    Directory.CreateDirectory(Path.Combine(eventPayPath, "email-logos"));
    Directory.CreateDirectory(Path.Combine(eventPayPath, "attachments"));
    Directory.CreateDirectory(Path.Combine(webRoot, "Documents", "MembershipDues"));
    // Family group photo (type=family) + individual family member photos (type=familymember).
    // Same Documents/ buckets as the migrated legacy photos so new + old serve from one place.
    Directory.CreateDirectory(Path.Combine(webRoot, "Documents", "directory"));
    Directory.CreateDirectory(Path.Combine(webRoot, "Documents", "FaimilyMembersPhoto"));
}
catch (Exception ex)
{
    app.Logger.LogWarning(ex, "Could not pre-create one or more upload directories under web root '{WebRoot}'. They will be created on first use if permissions allow.", app.Environment.WebRootPath);
}

if (app.Environment.WebRootPath == null)
{
    app.Environment.WebRootPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
}

// Configure the HTTP request pipeline
// When hosted as IIS child application under /API, set the path base
var pathBase = builder.Configuration["PathBase"];
if (!string.IsNullOrEmpty(pathBase))
{
    app.UsePathBase(pathBase);
}
// API docs only in Development (or Swagger:Enabled=true): no public endpoint map in production.
if (app.Environment.IsDevelopment() || builder.Configuration.GetValue<bool>("Swagger:Enabled"))
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("v1/swagger.json", "ROW API v1");
        c.RoutePrefix = "swagger";
    });
}
// Convert InvalidOperationException (business-rule violations) into 400 with JSON body, and the services'
// KeyNotFoundException / UnauthorizedAccessException into 404 / 403.
// Log every other unhandled exception with full stack so we can diagnose 500s from the API log.
app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException or UnauthorizedAccessException)
    {
        ctx.Response.StatusCode = ex is KeyNotFoundException ? 404 : ex is UnauthorizedAccessException ? 403 : 400;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsJsonAsync(new { message = ex.Message });
    }
    catch (Exception ex)
    {
        var logger = ctx.RequestServices.GetRequiredService<ILogger<Program>>();
        // A chat hub request carries the member's token in its query: never write that to the log.
        logger.LogError(ex, "Unhandled {Method} {Path}{Query} -> 500", ctx.Request.Method, ctx.Request.Path,
            ctx.Request.Query.ContainsKey("access_token") ? "" : ctx.Request.QueryString.Value);
        if (!ctx.Response.HasStarted)
        {
            ctx.Response.StatusCode = 500;
            ctx.Response.ContentType = "application/json";
            // Details only in Development; production shows a generic message (details are in the log above).
            await ctx.Response.WriteAsJsonAsync(app.Environment.IsDevelopment()
                ? new { message = ex.Message, type = ex.GetType().Name }
                : new { message = "Something went wrong. Please try again.", type = "ServerError" });
        }
    }
});

app.UseCors();
app.UseMiddleware<RotaryApi.Services.FeatureGateMiddleware>(); // skipped / switched-off modules answer 404
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<RotaryApi.Services.ScopeWriteGuardMiddleware>(); // club/district writes need a role for that club/district
app.UseMiddleware<RotaryApi.Services.TrialLockMiddleware>(); // build spec 3.5: an ended trial locks its district out
app.UseMiddleware<RotaryApi.Services.PlanningWriteGuardMiddleware>(); // planning districts: current year is read-only
app.UseMiddleware<RotaryApi.Services.MobileJwtRefreshMiddleware>();
app.UseMiddleware<RotaryApi.Services.AuditMiddleware>();
app.UseResponseCaching();
// Legacy-media '+' rescue: files uploaded before filenames were sanitized (0e2c3983) kept their
// spaces on disk (e.g. "RC Pulse 07 18-8-26_...pdf"). Their served URLs encode those spaces as '+',
// and IIS/StaticFiles treat '+' in the PATH as a LITERAL '+', so the spaced file is never found
// (→ 404 / "won't open"). New uploads are sanitized (no spaces/'+') so this only rescues the legacy
// backlog — WITHOUT renaming files, touching the DB, or re-uploading. When the literal-'+' file is
// missing but the '+'→space variant exists on disk, rewrite the request path to the real (spaced)
// name so the redirect check below + StaticFiles serve it. Guarded on File.Exists → healthy files
// are untouched. Runs regardless of the Media:RedirectBaseUrl config.
{
    string[] plusRescuePrefixes = { "/Documents", "/uploads", "/tempdocument" };
    var plusRescueWebRoot = app.Environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
    app.Use(async (ctx, next) =>
    {
        var p = ctx.Request.Path.Value ?? "";
        if ((HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))
            && p.Contains('+')
            && plusRescuePrefixes.Any(pre => p.StartsWith(pre, StringComparison.OrdinalIgnoreCase)))
        {
            var relLiteral = Uri.UnescapeDataString(p.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
            var literalPath = Path.Combine(plusRescueWebRoot, relLiteral);
            if (!System.IO.File.Exists(literalPath))
            {
                var spaced = p.Replace('+', ' ');
                var relSpaced = Uri.UnescapeDataString(spaced.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
                var spacedPath = Path.Combine(plusRescueWebRoot, relSpaced);
                if (System.IO.File.Exists(spacedPath))
                    ctx.Request.Path = spaced; // real on-disk name → redirect check + StaticFiles now match
            }
        }
        await next();
    });
}
// Gallery '.png → .jpg' rescue: PngToJpgTool turns PNG photos into JPEG under the same name and
// renames image_path in the DB, so every screen asks for the .jpg. Links built BEFORE the
// conversion (sent emails, shared links, app caches) still ask for
// the .png - when that .png is gone and the .jpg next to it exists, serve the .jpg instead.
// Guarded on File.Exists → untouched PNGs (logos, unconverted photos) are served as before.
{
    var pngRescueWebRoot = app.Environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
    app.Use(async (ctx, next) =>
    {
        var p = ctx.Request.Path.Value ?? "";
        if ((HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))
            && p.StartsWith("/Documents/gallery/", StringComparison.OrdinalIgnoreCase)
            && p.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
        {
            var rel = Uri.UnescapeDataString(p.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
            var pngPath = Path.Combine(pngRescueWebRoot, rel);
            if (!System.IO.File.Exists(pngPath) && System.IO.File.Exists(Path.ChangeExtension(pngPath, ".jpg")))
                ctx.Request.Path = p[..^4] + ".jpg"; // redirect check + StaticFiles now serve the JPEG
        }
        await next();
    });
}
// Media GET requests can be 302-redirected to an external host that physically serves the files
// (the legacy example.org site holding every migrated photo/document) — set "Media:RedirectBaseUrl".
// The SPA stays untouched: its <img src="/API/Documents/..."> is redirected to the external host, so
// reads come straight from that site and never need cross-vhost file access. Writes still go to the
// web root (see "Media:WebRoot"). Leave unset (go-live) to serve everything locally from wwwroot.
var mediaRedirectBase = builder.Configuration["Media:RedirectBaseUrl"];
if (!string.IsNullOrWhiteSpace(mediaRedirectBase))
{
    var redirectRoot = mediaRedirectBase.TrimEnd('/');
    string[] mediaPrefixes = { "/Documents", "/uploads", "/tempdocument" };
    var mediaWebRootForRedirect = app.Environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
    app.Use(async (ctx, next) =>
    {
        if (HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))
        {
            var p = ctx.Request.Path.Value ?? "";
            if (mediaPrefixes.Any(pre => p.StartsWith(pre, StringComparison.OrdinalIgnoreCase)))
            {
                // Serve locally if the file physically exists in THIS server's web root
                // (e.g. a picture just uploaded here — mass-email images, new documents).
                // Only 302 to the legacy media host for files that aren't here (migrated
                // assets). Without this, freshly-uploaded files bounce to the legacy host
                // where they don't exist.
                var rel = Uri.UnescapeDataString(p.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
                var localPath = Path.Combine(mediaWebRootForRedirect, rel);
                if (!System.IO.File.Exists(localPath))
                {
                    ctx.Response.Redirect(redirectRoot + p + ctx.Request.QueryString, permanent: false);
                    return;
                }
            }
        }
        await next();
    });
}
// Static files need explicit CORS headers — UseCors() above only applies to controllers/MVC,
// not StaticFiles middleware. Without these headers, cross-origin fetch() of /Documents/... etc.
// fails with CORS in dev (localhost:3000 → localhost:5000), which breaks blob-based downloads.
app.UseStaticFiles(new Microsoft.AspNetCore.Builder.StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // Static media (images / PDFs under /Documents, /uploads, /tempdocument) is public read-only
        // content fetched by the browser from any club/district-website domain — which can never be
        // enumerated. Reflect any Origin (with Vary) so those cross-origin fetch()es succeed. This
        // mirrors the open PublicOpen policy the api/public/* routes use. No credentials involved.
        var origin = ctx.Context.Request.Headers["Origin"].ToString();
        if (!string.IsNullOrEmpty(origin))
        {
            ctx.Context.Response.Headers["Access-Control-Allow-Origin"] = origin;
            ctx.Context.Response.Headers["Vary"] = "Origin";
        }
    }
});
app.MapControllers();
app.MapHub<ChatHub>("/api/chat/hub");

app.Run();
