# S5: emails, push, PDFs and exports in the member's language (build spec 3.3, 3.16)

Date: 2026-10-28 (revised the same day to use ASP.NET Core localization). Tier L. Built in the main tree after the
lane-spec merge.

## What exists already (reused, not rebuilt)

- Member language: `member_master_profile.PrimaryLanguage` ("Spanish" or "es"); `CommsTemplates.LanguageOf()` turns it
  into a code.
- Tenant language: `comm_settings.default_language` (club, then district, then `Brand.DefaultLanguage`) via
  `CommsTemplates.DefaultLanguageAsync()`.
- Per-language templates the tenant writes (`comm_templates` + `CommsTemplates.Pick`): greetings, meeting reminder,
  mass email. These stay as they are.
- Machine translation only in the admin (`/api/i18n/translate`, provider set by env). The API has none.

## The gap

About 45 other emails, push text, the in-app feed's fixed text ("Happy Birthday!"), 3 PDFs (dues receipt, club
monthly report, project share card) and the CSV / Excel exports build English text in code, and format dates and
numbers with the invariant culture.

## ASP.NET Core globalization and localization: what we use and what we don't

Source: learn.microsoft.com/aspnet/core/fundamentals/localization and .../localization/make-content-localizable
(ASP.NET Core 10, the API's target framework `net10.0`).

Used:
- **`IStringLocalizer` / `IStringLocalizer<T>`** (`Microsoft.Extensions.Localization`, in the ASP.NET Core shared
  framework, so no new package for the API). The indexer `L["Your password was changed, {0}.", name]` returns the
  translation for `CultureInfo.CurrentUICulture`. When there is none it returns the key, so **the English text is the
  key** ("keys are the default text" convention). Untranslated code keeps working unchanged.
- **A custom `IStringLocalizerFactory`**. The docs allow replacing the resx-backed default. Ours reads translations
  from the database (see below). Registered with `services.AddSingleton<IStringLocalizerFactory, DbStringLocalizerFactory>()`
  plus `AddLocalization()` for the generic `IStringLocalizer<T>`.
- **`CultureInfo.CurrentCulture` / `CurrentUICulture`**: the docs' globalization half. `CurrentUICulture` picks the
  text. `CurrentCulture` formats dates, numbers and currency (`ToString("D")` gives "jueves, 18 de febrero" in es). A
  small `using (MessageCulture.Use("es")) { ... }` scope sets both for one recipient and restores them afterwards.
  Both flow across `await`.
- **Culture fallback** (es-MX, then es, then the key). The factory does the same parent walk.

Not used, and why:
- **.resx resource files.** They hold hand-written translations per language, and the owner rule is machine
  translation, no manual files. The custom factory replaces them.
- **`UseRequestLocalization` middleware** (query, cookie and Accept-Language providers). It sets the culture of the
  *requester*. Our messages go to someone else: a password reset goes to the member, not the clicking admin, and
  jobs have no request. So the culture comes from the recipient's language, set with `MessageCulture.Use`. The admin
  and the app already translate their own screens, so API responses stay English.
- **`IHtmlLocalizer` / `IViewLocalizer`.** These are MVC views; the API has no Razor. Values go into email HTML with
  `WebUtility.HtmlEncode`, as today.

## Design

1. **Keys are the English text with `{0}` placeholders.** The provider only ever sees "Your password was changed,
   {0}." and never the name, email, link, token or password. A returned translation that lost or added a `{n}` is
   rejected, and the English text is used.
2. **`server_strings` table** (hash of English text, language, text, created). `DbStringLocalizerFactory` loads it
   into memory at start and on each new row (the API is one process; `shortcut:` comment, with a reload timer if it is
   scaled out).
3. **The indexer is synchronous, translation is not.** On a miss the indexer returns English and queues the key.
   When a key is seen for the first time, it is queued for **every language in use**: the distinct tenant languages
   plus member languages. So it is usually translated before the first non-English recipient needs it.
   `StringTranslationBackgroundService` drains the queue in batches through the provider, with an 8-second timeout,
   no retry, and the result stored in `server_strings`.
4. **Provider:** `Translation:Provider` = `none` (default) | `libretranslate` | `deepl` | `mymemory`, plus
   `Translation:ApiUrl` and `Translation:ApiKey` from env. With `none` nothing is queued and everything stays English.
5. **Language:**
   - Emails, push and feed: the member's language, else the tenant's.
   - PDFs, exports and emails to a role rather than a person: the tenant's.
   - Super Admin and platform operations emails stay English.
   - Anything a person typed is never translated.
6. **GreetingsWorker** (separate process, links API files): links the same small `ServerStrings` lookup file
   (Dapper only) for its digest push text, and reads `server_strings` read-only. The API's background service does
   the translating, so the worker needs no provider settings and no new package.

## Tasks

1. `server_strings` table (`DatabaseInitializer.SpecCompletion.cs`, `schema-drift.sql`, down script). Add
   `ServerStrings` (lookup + cache + queue), `DbStringLocalizerFactory` / `DbStringLocalizer`, `MessageCulture.Use`,
   `StringTranslationBackgroundService` and the provider client. Register in `Program.cs`. Unit-level e2e with a fake
   provider (like the fake Brevo on 5198): placeholders kept, a lost placeholder falls back to English, a stored row
   is used without a provider call, `none` sends nothing.
2. `EmailService`'s 12 named senders take the recipient's language, wrap their body in `MessageCulture.Use` and use
   `L[...]`. Callers pass the member's `PrimaryLanguage`.
3. The 29 `SendGenericEmailAsync` call sites: the member-facing ones wrap their fixed text in `L[...]`. The
   operations-only ones are listed in ROW-CHANGES as English by design.
4. Background mails: milestones (`EngagementService`), bulletin, trial / renewal / booth / onboarding.
5. Push: `AnnouncementPushBackgroundService` fixed labels per recipient language, grouped so each language is
   formatted once. GreetingsWorker digest text through the linked lookup.
6. In-app feed (`MobileNotificationFeedService`): the fixed titles in the reader's language. No Dart change; the
   app's `LiveTranslator` covers only text written in the app.
7. PDFs: the 3 builders run inside `MessageCulture.Use(tenantLanguage)`. Labels use `L[...]`, and dates and amounts
   format by culture.
8. Exports: header rows of the CSV / Excel endpoints the same way.
9. e2e `kb/tools/message_language_e2e.py`:
   - A Spanish member gets a Spanish password-changed email with their name intact and a Spanish date.
   - With provider `none`, the email is English.
   - A PDF and an export come back with translated headers.
   - The feed title is translated.
   Then ROW-CHANGES and `kb/rebuild.sh`.

Size: about 2 days.

## Open decision

The default provider: `none` (nothing leaves ROW until DeepL or LibreTranslate is chosen) or `mymemory` (the admin's
current free provider; only fixed wording with `{0}` placeholders is sent).

## Risks

- A key's first use in a language can go out in English while its translation is still queued. The per-language
  queueing of task 1.3 makes this rare.
- Machine translation of security text (password reset, trial lock-out) may read oddly. There is no review screen
  (owner rule: no manual translations). A bad string is fixed by deleting its `server_strings` row, which re-queues
  it.
- Changing an English literal makes a new key, so its translation starts over. That is expected with this convention.
