# Porting the RIZones .NET API to ROW (NestJS)

ROW reuses the **architecture, structure and features** of the RIZones API
(`reference/RotaryIndia_Admin_API_Claude/RotaryApi`). It does **not** reuse
anything that belongs to RIZones: no RIZones names, domains, phone numbers,
emails, logos, data, credentials, or India-only integrations. RIZones serves
India and its neighbours; ROW serves the rest of the world. The two products
have no connection at runtime.

The admin web app (`row/admin`) and the Flutter app (`row/mobile`) call this API
with the same routes and expect the same JSON, so a ported endpoint must answer
exactly as the C# one does (status, body shape, property names, null handling),
except where this guide says ROW differs.

## 1. Layout

| .NET | ROW |
|---|---|
| `Controllers/XController.cs` | `src/modules/<area>/x.controller.ts` |
| `Services/XService.cs` (+ `IXService`) | `src/modules/<area>/x.service.ts` (`@Injectable()` class, no separate interface) |
| `Services/XHelper.cs` (static) | `src/services/x.helper.ts` (exported functions) |
| `DTOs/XDtos.cs` | `src/dtos/x.dtos.ts` (`defineDto`) |
| `Program.cs` registrations | the area's `x.module.ts`, listed in `src/modules/index.ts` |
| `IConfiguration` | `AppConfig` (same keys: `config.get("Brevo:ApiKey")`) |
| `Brand.Current` / feature flags | `Brand.Current`, `Brand.feature("...")` from `src/brand/brand.ts` |

One Nest module per functional area (members, clubs, districts, projects,
communication, dues, ...). A shared service used by several areas lives in
`src/services` and is provided by `SharedModule`.

## 2. Controllers

```csharp
[ApiController, Route("api/clubs"), Authorize]
public class ClubsController : ControllerBase {
  [HttpGet("{id:int}")]
  public async Task<IActionResult> Get(int id) {
    var club = await _svc.GetAsync(id);
    if (club == null) return NotFound(new { message = "Club not found" });
    return Ok(club);
  }
}
```

```ts
@Controller("api/clubs")
@Authorize()
export class ClubsController {
  constructor(private readonly svc: ClubService) {}

  @Get(":id")
  async get(@Param("id") idText: string) {
    const id = routeInt(idText);              // {id:int}: non-numeric -> 404, as ASP.NET routing does
    const club = await this.svc.get(id);
    if (!club) return notFound({ message: "Club not found" });
    return ok(club);                          // or just `return club`
  }
}
```

- **Routes:** copy the template; `[controller]` becomes the class name without
  "Controller" (matching is case-insensitive). `{id}` becomes `:id`.
  Route constraints (`{id:int}`) use `routeInt()`; a failure is an empty 404.
- **Auth:** `[Authorize]` -> `@Authorize()`, `[AllowAnonymous]` -> `@AllowAnonymous()`,
  on the class or method, exactly where the C# has them. No attribute = anonymous.
- **User:** `User.FindFirst("memberId")?.Value` -> `user.findFirst("memberId")` with
  `@User() user: CurrentUser`. Port role checks literally: `roles.Contains("SuperAdmin")`
  on the claim *string* is a substring test -> `(user.findFirst("roles") ?? "").includes("SuperAdmin")`;
  on a `List<string>` it is exact -> `user.hasRole(...)`.
- **Results:** `Ok`, `NotFound`, `BadRequest`, `Unauthorized`, `Forbid`, `NoContent`,
  `StatusCode`, `File`, `Redirect`, `Content` -> `ok()`, `notFound()`, ... from
  `src/common/results.ts`. A bare `NotFound()` (no value) answers with ProblemDetails,
  as `[ApiController]` does; keep the distinction.
- **Binding:** `[FromBody] XDto dto` -> `@Body() body` then `XDto.create(body)` (case-insensitive,
  C# defaults). `[FromQuery] int page = 1` -> `@Query("page") page?: string` then
  `queryInt(page, 1)`. `[FromForm] IFormFile file` -> `@UseInterceptors(FileInterceptor("file"))`
  + `@UploadedFile()`. Keep the C# defaults.
- **try/catch in actions:** port them; they decide the status codes.
  `catch (UnauthorizedAccessException ex) => Unauthorized(new { message = ex.Message })` etc.
  Throw the same exception types (`src/common/exceptions.ts`) in services.
  An `InvalidOperationException` that escapes becomes 400 `{ message }`; anything
  else becomes 500 `{ message, type }` (global filter).

## 3. Data access

`Db` (pool) and `DbSession` (one connection) have Dapper's method names.
**Copy SQL verbatim**, `@Param` names included.

| Dapper | ROW |
|---|---|
| `QueryAsync<dynamic>(sql, p)` | `db.query(sql, p)` (rows keep column names) |
| `QueryAsync<XDto>(sql, p)` | `XDto.mapAll(await db.query(sql, p))` |
| `QueryFirstOrDefaultAsync<XDto>` | `XDto.map(await db.queryFirstOrDefault(sql, p))` |
| `ExecuteScalarAsync<int>` | `Number(await db.executeScalar(sql, p) ?? 0)` |
| `ExecuteAsync` | `db.execute(sql, p)` (rows matched, as MySqlConnector reports) |
| `QueryMultipleAsync` | `db.queryMultiple(sql, p)` |
| `commandType: StoredProcedure` | `db.callProcedure(name, p)` / `executeProcedure` |
| `using var conn = ...; ... BeginTransaction()` | `db.session(async (s) => s.transaction(async (tx) => ...))` |

- Use `db.session()` whenever the C# runs several commands on one connection
  (`LAST_INSERT_ID()`, temp tables, `@user` variables, transactions).
- `QueryAsync<int>` / `<string>`: map the first column: `rows.map(r => Object.values(r)[0])`.
- Typed results go through `defineDto` so JSON property names are camelCase by
  .NET's algorithm and missing columns get C# defaults. Raw `dynamic` results
  are returned as-is (column names unchanged), exactly like the C#.
- **Time:** ROW stores UTC. Sessions run with `time_zone = '+00:00'`, so `NOW()`
  and `CURDATE()` are UTC, and DATETIME values leave the API with a `Z`.
  `DateTime.Now`/`DateTime.UtcNow` in C# -> `new Date()`; SQL `NOW()` stays.
  Anything "per person's day" (birthdays, reminders, "today") uses the
  district's zone (`district_master.TimeZoneId`, else `Brand.Current.locale.defaultTimeZone`),
  never the server date. **Date-only values stored in DATETIME columns** (birth
  dates, anniversaries, project dates) must be returned without a zone: select
  them with `DATE_FORMAT(col, '%Y-%m-%d')` or map them through a `"string"` DTO
  field fed by such a select, and list them in `docs/datetime-audit.md`.
- Year-wise project tables (`rotary_projects_YYYY_YY`) are created on demand by
  the ported `YearTableResolver`.

## 4. What ROW changes while porting

| RIZones | ROW |
|---|---|
| Cashfree, Razorpay (+ Route splits, KYC, settlements) | `PaymentGateway` interface with Stripe and PayPal adapters on the district's or club's own account (master plan WS6). India-only screens are not ported. |
| Interakt WhatsApp, DLT SMS | `WhatsAppSender` (Meta Cloud API), `SmsSender` (Twilio) behind interfaces; template registry per language. |
| GST 18 % | `Brand.Current.providers.taxRules` (empty: no tax). |
| INR, `en-IN`, IST, `+91` | the record's currency, else the district's, else the brand's; district time zone; E.164 phone numbers. |
| "Rotary Zones 4, 5, 6, 7 & 8", rizones/rotaryindia domains, support phones, Kaizen addresses | `Brand.Current.*` values. Never a literal. |
| Email header/footer HTML with the RIZones logo | built from `Brand.Current.look` / `support`. |
| Zones 4–8 programmes (zonal awards, district citation) | ported, behind `modules.zonalAwards` / `modules.citation` (off); no seed content. |
| Shrigoda partner API, club-profile-report API, rotaryindia.org SSO bridge, "Add to org" extension, PPH camps | not ported unless the product owners ask (PPH behind `modules.pphCamps`). |
| Hard-coded ids (COG club 31598, pilot club 2765, test district "3142") | `Brand.Current.scope.*` (0/empty for ROW). |
| Secrets in appsettings | environment variables only (`Brevo__ApiKey`, `JwtSettings__Secret`, ...). |

A literal string that names a product, a domain, a phone number or a person
is a bug in ROW. `npm run lint:rizones` (tools/check-rizones.mjs) fails on them.

## 5. Background services and workers

`BackgroundService` / `IHostedService` -> a provider with `@Cron`/`@Interval`
from `@nestjs/schedule`, registered only when `BackgroundJobs:Enabled` is true.
The three workers (Rotary.org sync, greetings, awards) become separate entry
points under `src/workers/` built from the same code, run by the scheduler of
the host (Windows Task Scheduler / cron), one process per job.

## 6. Order of work

1. Shared core (`src/services`): kill switch, year tables, currency, access
   helpers, email, SMS/WhatsApp senders, push, image and document helpers.
2. Auth and mobile auth; members, clubs, districts, zones, modules, roles.
3. Club and district dashboards; communication (announcements, events,
   newsletters, documents, greetings, mass email); projects; reports (CMR,
   attendance); goal setting; foundation/TRF.
4. Payments (Stripe, PayPal), dues, event payment links, privacy (WS7).
5. Rotary.org sync worker, greetings worker, scheduled jobs.
6. Everything else, then remove what ROW does not offer.

## 7. Definition of done for a ported controller

- Every action of the C# controller exists with the same route, method, auth,
  status codes and JSON shape (or is listed as intentionally not ported, with the reason).
- `npx tsc --noEmit` is clean; `npm test` is green.
- A spec under the module checks at least: one success path against the test
  database, one auth refusal, one not-found / bad-request path.
- No RIZones literal (`npm run lint:rizones`).
