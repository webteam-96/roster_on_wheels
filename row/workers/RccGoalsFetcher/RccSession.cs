using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Playwright;

namespace RccGoalsFetcher;

/// Why a sign-in failed. BadCredentials = Rotary's page said the email / password is wrong (or the
/// account is locked) - never retry. Mfa = Rotary asked for an extra verification step / code.
/// Other = anything else (timeouts, page changed, network) - may work next time.
public enum LoginFailure { BadCredentials, Mfa, Other }

public sealed class RccLoginException(LoginFailure kind, string message) : Exception(message)
{
    public LoginFailure Kind { get; } = kind;
}

// Signs in to My Rotary exactly like a person (my.rotary.org -> id.rotary.org -> rcc.rotary.org)
// and then calls the Rotary Club Central OData API (https://rcc.rotary.org/v1/...) inside that
// browser session. The API rejects plain cookie calls ("Authorization has been denied"), so the
// headers the RCC app itself sends on its first successful /v1/ call are copied onto ours.
// GET only - nothing is ever written to Rotary.org.
public sealed class RccSession : IAsyncDisposable
{
    private static readonly HashSet<string> SkipHeaders = new(StringComparer.OrdinalIgnoreCase)
        { "host", "cookie", "content-length", "connection", "accept-encoding" };

    private readonly Settings _s;
    private readonly string _email, _password;
    private IPlaywright? _pw;
    private IBrowser? _browser;
    private IBrowserContext? _ctx;
    private Dictionary<string, string> _headers = new();
    private readonly SemaphoreSlim _loginLock = new(1, 1);
    private int _loginCount;
    private int _loginGen; // bumps on every successful sign-in; lets parallel 401s share one re-login

    public RccSession(Settings s) : this(s, s.Email, s.Password) { }

    /// Signs in with the given Rotary.org login instead of Rcc:Email / Rcc:Password (worker mode:
    /// each District Governor's own login). The password is only typed into Rotary's sign-in page.
    public RccSession(Settings s, string email, string password) { _s = s; _email = email; _password = password; }

    public async Task LoginAsync()
    {
        await _loginLock.WaitAsync();
        try { await LoginCoreAsync(); }
        finally { _loginLock.Release(); }
    }

    private async Task LoginCoreAsync()
    {
        _loginCount++;
        if (_ctx != null) { await _ctx.CloseAsync(); _ctx = null; }
        _pw ??= await Playwright.CreateAsync();
        if (_browser == null)
        {
            var opts = new BrowserTypeLaunchOptions { Headless = _s.Headless };
            if (!string.IsNullOrWhiteSpace(_s.BrowserChannel)) opts.Channel = _s.BrowserChannel;
            _browser = await _pw.Chromium.LaunchAsync(opts);
        }
        _ctx = await _browser.NewContextAsync(new BrowserNewContextOptions { Locale = "en-US" });
        var page = await _ctx.NewPageAsync();

        Log.Info($"Signing in to My Rotary (attempt {_loginCount})...");
        // The login page redirects a few times while it loads, so don't wait for "load" - just start
        // looking for the form (it may sit in a frame: Rotary's Okta sign-in widget).
        await page.GotoAsync(_s.LoginUrl, new PageGotoOptions { Timeout = 120_000, WaitUntil = WaitUntilState.Commit });
        var (frame, email) = await FindEmailBoxAsync(page, TimeSpan.FromSeconds(120))
            ?? throw new RccLoginException(LoginFailure.Other, $"My Rotary sign-in form not found (page: {UrlOnly(page.Url)}). Run with --show-browser to see the page.");
        await email.FillAsync(_email);

        // Some Okta layouts ask for the email first and show the password on the next step.
        var pwd = frame.Locator("input[type='password']").First;
        if (!await pwd.IsVisibleAsync())
        {
            var next = frame.GetByRole(AriaRole.Button, new FrameGetByRoleOptions { NameRegex = new System.Text.RegularExpressions.Regex("^(next|continue)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase) });
            if (await next.CountAsync() > 0) await next.First.ClickAsync();
        }
        try { await pwd.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 }); }
        catch (TimeoutException)
        {
            // No password box after the email step: Rotary refused the email, or asks for a code first.
            if (await DetectProblemAsync(page) is { } p) throw new RccLoginException(p.Kind, p.Message);
            throw new RccLoginException(LoginFailure.Other, $"Password box did not appear on the sign-in page (page: {UrlOnly(page.Url)}).");
        }
        await pwd.FillAsync(_password);

        // The RCC app's first successful /v1/ call carries the auth headers we need.
        var firstOk = page.WaitForResponseAsync(
            r => r.Url.Contains("rcc.rotary.org/v1/", StringComparison.OrdinalIgnoreCase) && r.Status == 200,
            new PageWaitForResponseOptions { Timeout = 180_000 });

        var signIn = frame.GetByRole(AriaRole.Button, new FrameGetByRoleOptions { NameRegex = new System.Text.RegularExpressions.Regex("^(sign in|log in|login|verify)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase) });
        if (await signIn.CountAsync() > 0) await signIn.First.ClickAsync();
        else await frame.Locator("button[type='submit'], input[type='submit']").First.ClickAsync();

        // Wait for RCC; meanwhile watch the sign-in page for Rotary's own "wrong password" message or
        // an extra verification step, so those are told apart from a slow / broken sign-in.
        var clickedAt = DateTime.UtcNow;
        while (!firstOk.IsCompleted)
        {
            await Task.WhenAny(firstOk, Task.Delay(1500));
            if (firstOk.IsCompleted || DateTime.UtcNow - clickedAt < TimeSpan.FromSeconds(3)) continue;
            if (await DetectProblemAsync(page) is { } p) throw new RccLoginException(p.Kind, p.Message);
        }
        IResponse resp;
        try { resp = await firstOk; }
        catch (TimeoutException)
        {
            if (await DetectProblemAsync(page) is { } p) throw new RccLoginException(p.Kind, p.Message);
            throw new RccLoginException(LoginFailure.Other,
                $"Sign-in did not reach Rotary Club Central (stopped at {UrlOnly(page.Url)}). Check the Rotary.org email / password, or whether Rotary now asks for a code.");
        }

        var all = await resp.Request.AllHeadersAsync();
        _headers = all.Where(h => !h.Key.StartsWith(':') && !SkipHeaders.Contains(h.Key))
                      .ToDictionary(h => h.Key, h => h.Value, StringComparer.OrdinalIgnoreCase);
        _headers["accept"] = "application/json";
        _loginGen++;
        Log.Info("Signed in to Rotary Club Central.");
    }

    // Rotary's sign-in (Okta widget on id.rotary.org / my.rotary.org). Wrong email / password: the
    // widget stays on the form and shows an error box ("Unable to sign in", "Password is incorrect",
    // "Authentication failed", "There is no account with ..."). Extra verification: the password box is
    // gone and the page asks for a code / a security method ("Verify with your email", "Enter a code",
    // "Okta Verify", "Set up security methods"), or shows a one-time-code input. Nothing is decided once
    // the browser is on rcc.rotary.org (signed in; RCC itself is loading).
    private static readonly Regex BadCredText = new(
        @"incorrect|invalid (user|e-?mail|password|credentials|login)|unable to sign in|sign[- ]?in failed|authentication failed|" +
        @"not (be )?recogni[sz]ed|no account|does not match|wrong (e-?mail|password)|locked|do(es)? not exist",
        RegexOptions.IgnoreCase);
    private static readonly Regex MfaText = new(
        @"verify (it'?s you|with your (e-?mail|phone)|with okta)|verification (code|e-?mail)|enter (the |a |your )?(\d+[- ]digit )?code|" +
        @"security method|authenticator|okta verify|send me (an e-?mail|a code)|we (just )?sent|check your e-?mail|multi-?factor|" +
        @"two-?step|2-?step|set up (security|multifactor)|one-?time (code|pass)",
        RegexOptions.IgnoreCase);
    private const string ErrorBoxCss = ".o-form-error-container, .okta-form-infobox-error, .infobox-error, .o-form-input-error, " +
                                       "[role='alert'], .messages--error, .alert-danger, .error-message, .form-error";
    private const string CodeBoxCss = "input[name='credentials.passcode'], input[autocomplete='one-time-code'], input[name='verificationCode'], " +
                                      "input[name*='otp' i], input[name*='passcode' i]";

    private static async Task<(LoginFailure Kind, string Message)?> DetectProblemAsync(IPage page)
    {
        try
        {
            if (page.Url.Contains("rcc.rotary.org", StringComparison.OrdinalIgnoreCase)) return null;
            var pwdVisible = false;
            foreach (var f in page.Frames)
            {
                try
                {
                    var errs = f.Locator(ErrorBoxCss);
                    var n = Math.Min(await errs.CountAsync(), 10);
                    for (var i = 0; i < n; i++)
                    {
                        var e = errs.Nth(i);
                        if (!await e.IsVisibleAsync()) continue;
                        var t = Clean(await e.InnerTextAsync(new LocatorInnerTextOptions { Timeout = 2000 }));
                        if (t != "" && BadCredText.IsMatch(t))
                            return (LoginFailure.BadCredentials, "Rotary.org refused the email / password: " + Trunc(t, 200));
                    }
                    var pw = f.Locator("input[type='password']");
                    if (await pw.CountAsync() > 0 && await pw.First.IsVisibleAsync()) pwdVisible = true;
                }
                catch { /* frame navigated away while we looked */ }
            }
            if (pwdVisible) return null;   // still on the password form (Okta's own heading there is "Verify with your password")
            foreach (var f in page.Frames)
            {
                try
                {
                    var code = f.Locator(CodeBoxCss);
                    if (await code.CountAsync() > 0 && await code.First.IsVisibleAsync())
                        return (LoginFailure.Mfa, "Rotary.org asks for an extra verification code for this login.");
                    var body = f.Locator("body");
                    if (await body.CountAsync() == 0) continue;
                    var text = Clean(await body.First.InnerTextAsync(new LocatorInnerTextOptions { Timeout = 2000 }));
                    if (text.Length > 4000) text = text[..4000];
                    var m = MfaText.Match(text);
                    if (m.Success) return (LoginFailure.Mfa, $"Rotary.org asks for an extra verification step for this login (\"{Trunc(m.Value, 60)}\").");
                }
                catch { /* frame navigated away while we looked */ }
            }
        }
        catch { /* page closed / navigating - decide on the next look */ }
        return null;
    }

    private static string Clean(string? t) => Regex.Replace(t ?? "", @"\s+", " ").Trim();
    // Page address without its query string (Okta puts state / tokens there) - for log / error text.
    private static string UrlOnly(string url) { var q = url.IndexOfAny(['?', '#']); return q < 0 ? url : url[..q]; }

    // Looks in the page and every frame for the email box: by its visible label first, then the
    // usual field names (Okta uses "username" / "identifier").
    private static async Task<(IFrame Frame, ILocator Box)?> FindEmailBoxAsync(IPage page, TimeSpan timeout)
    {
        const string css = "input[type='email'], input[autocomplete='username'], input[name='username'], input[name='identifier'], " +
                           "input[name*='mail' i], input[id*='mail' i], input[id*='username' i]";
        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until)
        {
            foreach (var f in page.Frames)
            {
                try
                {
                    foreach (var loc in new[] { f.GetByLabel(new System.Text.RegularExpressions.Regex("email", System.Text.RegularExpressions.RegexOptions.IgnoreCase)), f.Locator(css) })
                    {
                        var first = loc.First;
                        if (await first.CountAsync() > 0 && await first.IsVisibleAsync()) return (f, first);
                    }
                }
                catch { /* frame navigated away while we looked */ }
            }
            await Task.Delay(1000);
        }
        return null;
    }

    /// GET one OData URL (relative to ApiBase). Retries 3x; on 401 signs in again once per call.
    public async Task<JsonElement> GetAsync(string relativeUrl)
    {
        var url = _s.ApiBase.TrimEnd('/') + relativeUrl;
        var relogged = false;
        for (var attempt = 1; ; attempt++)
        {
            // Wait out a re-login another call may be doing (its context is closed meanwhile).
            await _loginLock.WaitAsync();
            var gen = _loginGen;
            var ctx = _ctx!;
            var headers = _headers;
            _loginLock.Release();

            IAPIResponse r;
            try
            {
                r = await ctx.APIRequest.GetAsync(url, new APIRequestContextOptions { Headers = headers, Timeout = 120_000 });
            }
            catch (Exception ex) when (attempt < 4)
            {
                Log.Warn($"GET failed ({ex.Message.Split((char)10)[0]}) - retry {attempt}: {relativeUrl}");   // first line only - no headers/cookie in the log
                await Task.Delay(2000 * attempt);
                continue;
            }

            if (r.Status == 401 && !relogged)
            {
                relogged = true;
                await _loginLock.WaitAsync();
                try
                {
                    // Only the first call to hit the expiry signs in; the others reuse that new session.
                    if (_loginGen == gen)
                    {
                        Log.Warn("Session expired (401) - signing in again.");
                        await LoginCoreAsync();
                    }
                }
                finally { _loginLock.Release(); }
                continue;
            }
            if (r.Ok)
            {
                var body = await r.BodyAsync();
                return JsonDocument.Parse(body).RootElement.Clone();
            }
            if (attempt < 4 && (r.Status == 429 || r.Status >= 500))
            {
                Log.Warn($"HTTP {r.Status} - retry {attempt}: {relativeUrl}");
                await Task.Delay(3000 * attempt);
                continue;
            }
            var text = await r.TextAsync();
            throw new HttpRequestException($"HTTP {r.Status} for {relativeUrl}: {Trunc(text, 300)}");
        }
    }

    /// Raw text GET (e.g. the OData $metadata XML) - used by --probe only.
    public async Task<(int Status, string Body)> GetTextAsync(string relativeUrl)
    {
        var r = await _ctx!.APIRequest.GetAsync(_s.ApiBase.TrimEnd('/') + relativeUrl, new APIRequestContextOptions { Headers = _headers, Timeout = 120_000 });
        return (r.Status, await r.TextAsync());
    }

    /// OData list: returns the "value" array items, following @odata.nextLink pages.
    public async Task<List<JsonElement>> GetListAsync(string relativeUrl)
    {
        var items = new List<JsonElement>();
        var next = relativeUrl;
        while (next != null)
        {
            var root = await GetAsync(next);
            next = null;
            if (root.ValueKind == JsonValueKind.Array) { items.AddRange(root.EnumerateArray()); break; }
            if (root.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.Array) items.AddRange(v.EnumerateArray());
            else { items.Add(root); break; }
            foreach (var k in new[] { "@odata.nextLink", "odata.nextLink" })
                if (root.TryGetProperty(k, out var nl) && nl.ValueKind == JsonValueKind.String)
                {
                    var abs = nl.GetString()!;
                    next = abs.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? new Uri(abs).PathAndQuery : abs;
                }
        }
        return items;
    }

    /// $top/$skip paging for endpoints that page that way (OrgNodes).
    public async Task<List<JsonElement>> GetPagedAsync(string relativeUrlWithoutPaging, int pageSize = 500, int maxRows = 200_000)
    {
        var all = new List<JsonElement>();
        var sep = relativeUrlWithoutPaging.Contains('?') ? "&" : "?";
        for (var skip = 0; skip < maxRows; skip += pageSize)
        {
            var page = await GetListAsync($"{relativeUrlWithoutPaging}{sep}$top={pageSize}&$skip={skip}");
            all.AddRange(page);
            if (page.Count < pageSize) break;
        }
        return all;
    }

    private static string Trunc(string s, int n) => s.Length <= n ? s : s[..n] + "...";

    public async ValueTask DisposeAsync()
    {
        if (_ctx != null) await _ctx.CloseAsync();
        if (_browser != null) await _browser.CloseAsync();
        _pw?.Dispose();
    }
}
