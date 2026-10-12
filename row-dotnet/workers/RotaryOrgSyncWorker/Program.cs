using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RotaryOrgSyncWorker.Services;

Console.WriteLine("=========================================");
Console.WriteLine(" Rotary.org Sync Worker");
Console.WriteLine("=========================================");

var mode = args.Length > 0 ? args[0].ToLowerInvariant() : "--help";

if (mode == "--help" || mode == "-h" || mode == "/?" || mode == "/help")
{
    Console.WriteLine("");
    Console.WriteLine("Usage:");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --bootstrap          Full sync of all clubs (~70 min, one-time)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --delta              Daily incremental sync (only changed clubs)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-sync        Daily member sync (add/update/terminate)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --repair-sync        Insert sync clubs missing from DB (after adding districts)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --country-sync       Nightly country sync (India/Sri Lanka/Nepal)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --country-sync --dry-run                  Same, but NO DB writes / NO email — just prints what would happen");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --country-sync --dry-run --club-id 90395  Dry-run restricted to ONE club (ClubRotaryId)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --terminate-clubs    Audit clubs gone from /clubs AND /Clubs/search (no DB changes)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --terminate-clubs --apply   Actually cascade soft-delete the terminated clubs");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --club-reconcile      DAILY: full /clubs pass, difference-only. (1) non-sync→sync + member sync  (2) sync→non-sync + soft-delete members  (3) new club → insert + member sync. Ends with a ROW-vs-/clubs count verdict.");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --club-reconcile --no-down    Same, but SKIP the sync→non-sync direction (no soft-deletes)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --club-reconcile --force      Same, but bypass the non-sync safety threshold (RotaryOrgSync:MaxAutoNonSyncPerRun, default 20)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --non-sync-cascade    Audit clubs that went sync→non-sync (still on /Clubs/search) — no DB changes");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --non-sync-cascade --apply   Flip those clubs to non-sync + soft-delete their members (keeps club; never touches profiles)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --website-orphan-cleanup   Audit club_websites whose club is inactive/deleted/terminated (no DB changes)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --website-orphan-cleanup --apply   Soft-delete those websites (isdeleted=1, Status='Inactive'). Also runs nightly in --club-reconcile.");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --list-districts     Export all districts (3 countries) to CSV");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --list-world-districts  Export ALL world districts (~210 countries) to CSV");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --world-sync          One-time sync: insert all worldwide clubs into club_master");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --world-ensure        Full importer: zones + districts + clubs in one shot");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --world-clubs --dry-run   MANUAL: preview all-country NON-SYNC club import (no DB writes; report email)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --world-clubs         MANUAL: insert missing clubs worldwide as NON-SYNC (club row only, no modules; existing clubs untouched; new districts -> 'Other Zones')");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-sweep        Per-club member sweep: ADD/UPDATE/SOFT-DELETE for synced clubs");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-sweep --club-id 28046           Full sweep of ONE club (ClubRotaryId, ALL members, no time filter)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-sweep --club-id 28046,28047,28048   Full sweep of MANY clubs (comma-separated ClubRotaryIds)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-sweep --districts 3233,3244   Sweep ONLY listed districts");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-sweep --failed-list \"C:\\path\\failed.xlsx\"   Retry ONLY (RotaryId, ClubRotaryId|ClubId) pairs in xlsx (skips terminations)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-daily-delta  Daily delta: only clubs changed in last 10 days, ADDs filtered to recent admissions");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-count-reconcile  MORNING: cheap /clubs-count filter, then member-sweep ONLY sync clubs whose count differs (add+terminate, profiles kept). Emails 'Mismatch Member Sync'.");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-count-reconcile --districts 3142   Reconcile mismatched clubs in ONE/many districts only (club-page 'Sync mismatched' button)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-daily-delta --club-id 28046           Daily-delta logic on ONE club (ClubRotaryId, bypasses /clubs/updates)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-daily-delta --club-id 28046,28047,28048   Daily-delta on many clubs (comma-separated ClubRotaryIds)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --joindate-sync           Joining-date ONLY: update club_members.JoinedDate from Rotary.org (all clubs, fast, no profile/add/terminate)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --member-refresh --member-id 6013684   VERIFY ONE member: refresh DOB + JoinedDate for one/many RotaryIds, print before→after (comma-separate for many)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --dedup-norid          AUDIT no-RotaryId duplicates in synced clubs (except 3 districts): salvage mobile to RID twin's secondary + soft-delete. Dry run.");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --dedup-norid --apply   APPLY the no-RotaryId dedup (writes; logs to dedup_norid_log). Add --districts 3070 to scope.");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --dob-sync   Date-of-birth ONLY: refresh member_master_profile.BirthDate from Rotary.org (correct MM/dd/yyyy parse). Fixes swapped day/month + year-1900 DOBs.");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --dob-sync --districts 3070   DOB-only for one/many districts (or --club-id 86427[,...], or no filter = all members)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --joindate-sync --club-id 86427   Joining-date only for ONE club (ClubRotaryId; comma-separate for many)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --joindate-sync --club-id-file \"C:\\path\\ids.txt\"   Joining-date only for ClubRotaryIds read from a file (comma/newline separated)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --joindate-sync --districts 3233,3244   Joining-date only for listed districts; add --no-honorary / --concurrency N to tune");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --club-sync --club-id 28046   Refresh ONE club's MeetingAddress/Day/Time from Rotary.org");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --normalize-states       Bulk-fix every India-country club's State column (idempotent, DB-only)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --bod-sync                Per-club BOD sync (designations + board_of_directors + DC auto-groups)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --bod-sync --club-id 28046  BOD sync single club (--club-id = ClubRotaryId, e.g. 28046)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --bod-sync --recent        BOD sync only LAST/CURRENT/FUTURE years (faster; weekly run does full history)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --bod-subgroup-sync       Rebuild Club + District sub-groups from BOD (run daily at night)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --dc-cpcs-reconcile       AUDIT: DC Club Presidents/Secretaries groups vs BOD (all years) — no DB changes");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --dc-cpcs-reconcile --apply   NIGHTLY: remove group rows not backed by BOD + add missing BOD holders (also runs after every full --bod-sync)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --dc-cpcs-reconcile --apply --force   Same, bypassing the removal safety threshold (RotaryOrgSync:MaxAutoDcCpcsRemovePerRun, default 500)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --probe-club-members <ClubRotaryId>   Dump raw JSON from /clubs/{type}/{id}/members (no DB writes)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --probe-club-officers <ClubRotaryId> [fromYear]   Dump raw JSON from /clubs/{type}/{id}/officers (no DB writes)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --diagnose-district 3142   Compare API vs DB for one district");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --diagnose-all       Compare API vs DB for ALL districts");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --export-district 3142   Export ALL clubs in district from API to CSV");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --export-all         Export ALL unique clubs across 3 countries to CSV");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --ping               Test Rotary.org connectivity");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --resend-report      Resend latest sync email (uses live DB state)");
    Console.WriteLine("  RotaryOrgSyncWorker.exe --resend-report 6    Resend email for specific log id (e.g. 6)");
    Console.WriteLine("");
    return 1;
}

// Build configuration
var config = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
    .Build();
RotaryApi.Services.Brand.Init(config);

// DI container
var services = new ServiceCollection();
services.AddSingleton<IConfiguration>(config);
services.AddLogging(b => b
    .AddSimpleConsole(o =>
    {
        o.SingleLine = true;
        o.TimestampFormat = "HH:mm:ss ";
    })
    .SetMinimumLevel(LogLevel.Information));
services.AddHttpClient<IRotaryOrgApiClient, RotaryOrgApiClient>();
services.AddSingleton<EmailReportSender>();
services.AddSingleton<ClubSyncWorker>();
services.AddSingleton<CountrySyncWorker>();
services.AddSingleton<ClubTerminator>();
services.AddSingleton<ClubNonSyncCascadeWorker>();
services.AddSingleton<ClubWebsiteOrphanCleanup>();
services.AddSingleton<MemberSyncWorker>();
services.AddSingleton<DistrictListExporter>();
services.AddSingleton<DistrictDiagnoser>();
services.AddSingleton<WorldDistrictExporter>();
services.AddSingleton<WorldSyncWorker>();
services.AddSingleton<WorldEnsureWorker>();
services.AddSingleton<WorldClubImportWorker>();
services.AddSingleton<ClubMemberSweepWorker>();
services.AddSingleton<DcCpcsReconciler>();
services.AddSingleton<BodSyncWorker>();
services.AddSingleton<BodSubGroupSyncWorker>();
services.AddSingleton<ReportResender>();
var sp = services.BuildServiceProvider();

// Hook Ctrl+C for graceful shutdown
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Cancellation requested — finishing current club then stopping...");
    cts.Cancel();
};

try
{
    if (mode == "--bootstrap")
    {
        var worker = sp.GetRequiredService<ClubSyncWorker>();
        await worker.RunBootstrapAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — bootstrap complete. Press any key to exit...");
        if (!Console.IsInputRedirected) Console.ReadKey();
        return 0;
    }

    if (mode == "--delta")
    {
        var worker = sp.GetRequiredService<ClubSyncWorker>();
        await worker.RunDeltaAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — delta complete.");
        // No "Press any key" here so Task Scheduler can exit cleanly.
        return 0;
    }

    if (mode == "--member-sync")
    {
        var worker = sp.GetRequiredService<MemberSyncWorker>();
        await worker.RunAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — member sync complete.");
        // No "Press any key" so Task Scheduler can exit cleanly.
        return 0;
    }

    // Nightly full-list club reconcile — the DIFFERENCE-ONLY daily job. Unlike --delta (which
    // only sees the /clubs/updates change feed and so leaves an unchanged-but-mis-flagged club
    // non-sync forever), this does a FULL /clubs pass and handles all THREE conditions, but only
    // ever touches clubs that actually differ — never all 3942:
    //   1. in /clubs, flagged non-sync here → flip to sync,  THEN member-sync that club
    //   3. in /clubs, missing here          → insert club,   THEN member-sync that club
    //   2. flagged sync here, NOT in /clubs → flip to non-sync + soft-delete its members
    // Condition 2 is delegated to ClubNonSyncCascadeWorker, which already: skips the exempt
    // districts (5656 / 1280 / IFRM India), keeps the club row, never touches member profiles
    // or credentials, and ABORTS if more clubs than RotaryOrgSync:MaxAutoNonSyncPerRun (default
    // 20) look non-sync — i.e. a Rotary.org /clubs blip can't mass-delete members unattended.
    // Use --no-down to skip condition 2, or --force to bypass that safety threshold.
    if (mode == "--club-reconcile")
    {
        var rcFlags = args.Skip(1).Select(a => a.Trim().ToLowerInvariant()).ToHashSet();
        bool skipDown = rcFlags.Contains("--no-down");
        bool rcForce = rcFlags.Contains("--force");

        // ── Conditions 1 + 3 — flip non-sync→sync, insert new clubs, member-sync just those ──
        var clubWorker = sp.GetRequiredService<ClubSyncWorker>();
        var affected = await clubWorker.RunRepairSyncAsync(cts.Token);

        if (affected.Count > 0)
        {
            Console.WriteLine("");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Club flag reconcile touched {affected.Count} club(s) — syncing their members now...");
            var memberWorker = sp.GetRequiredService<ClubMemberSweepWorker>();
            await memberWorker.RunForClubRotaryIdsAsync(affected, cts.Token);
        }
        else
        {
            Console.WriteLine("");
            Console.WriteLine("No clubs flipped or inserted — nothing to member-sync.");
        }

        // ── Condition 2 — flip sync→non-sync + soft-delete those clubs' members ──
        if (skipDown)
        {
            Console.WriteLine("");
            Console.WriteLine("--no-down passed — skipping the sync->non-sync direction.");
        }
        else
        {
            Console.WriteLine("");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Checking for clubs that dropped OUT of /clubs (sync -> non-sync)...");
            try
            {
                var cascade = sp.GetRequiredService<ClubNonSyncCascadeWorker>();
                await cascade.RunAsync(apply: true, force: rcForce, ct: cts.Token);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                // Conditions 1 + 3 have ALREADY been applied at this point. A /Clubs/search
                // hiccup on Rotary.org's side must not throw that away or hide the final count.
                Console.WriteLine("");
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] WARNING — sync->non-sync check could not run: {ex.Message}");
                Console.WriteLine("  Conditions 1 + 3 above WERE applied. Nothing was soft-deleted.");
                Console.WriteLine("  Retry that direction on its own with:");
                Console.WriteLine("    RotaryOrgSyncWorker.exe --non-sync-cascade           (audit)");
                Console.WriteLine("    RotaryOrgSyncWorker.exe --non-sync-cascade --apply   (flip + soft-delete)");
            }
        }

        // ── Termination AUDIT — clubs gone from BOTH /clubs AND /Clubs/search ──
        // Audit-first by design: the nightly reconcile only REPORTS (emails) which clubs would be
        // cascade-soft-deleted; it never deletes them here. Review the audit email, then apply with:
        //   RotaryOrgSyncWorker.exe --terminate-clubs --apply
        Console.WriteLine("");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Auditing clubs gone from BOTH /clubs AND /Clubs/search (audit-only, no deletes)...");
        try
        {
            var terminator = sp.GetRequiredService<ClubTerminator>();
            await terminator.RunAsync(apply: false, force: false, ct: cts.Token);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] WARNING — termination audit could not run: {ex.Message}");
            Console.WriteLine("  (the reconcile steps above still applied; nothing was terminated)");
        }

        // ── Club website orphan cleanup (APPLY) — soft-delete websites whose club is
        //    inactive / deleted / terminated so a dead club can't keep a live site. This is the
        //    catch-all that also covers MANUAL deactivations (IsActive=0 / isdeleted=1 set outside
        //    the sync flow). Safe + reversible (only touches the club_websites row). Has its own
        //    safety threshold (RotaryOrgSync:MaxAutoWebsiteCleanupPerRun) so a mass-event emails
        //    instead of mass-deleting.
        Console.WriteLine("");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Cleaning orphaned club websites (club inactive/deleted)...");
        try
        {
            var websiteCleanup = sp.GetRequiredService<ClubWebsiteOrphanCleanup>();
            await websiteCleanup.RunAsync(apply: true, force: rcForce, ct: cts.Token);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] WARNING — website orphan cleanup could not run: {ex.Message}");
            Console.WriteLine("  (the reconcile steps above still applied)");
        }

        // ── Final verdict: ROW synced count MUST equal the Rotary.org /clubs total ──
        try
        {
            var rcCfg = sp.GetRequiredService<IConfiguration>();
            await using var rcConn = new MySqlConnector.MySqlConnection(rcCfg.GetConnectionString("DefaultConnection"));
            await rcConn.OpenAsync(cts.Token);
            var syncedFinal = await Dapper.SqlMapper.ExecuteScalarAsync<int>(rcConn,
                "SELECT COUNT(*) FROM club_master WHERE IFNULL(IsSyncedFromRotaryOrg,0) = 1 AND isdeleted = 0");
            Console.WriteLine("");
            Console.WriteLine("=== FINAL COUNT ===");
            Console.WriteLine($"  Rotary.org /clubs total: {clubWorker.LastClubsTotal}");
            Console.WriteLine($"  Synced in ROW now:   {syncedFinal}");
            Console.WriteLine(syncedFinal == clubWorker.LastClubsTotal
                ? "  ==> COUNT MATCHES."
                : $"  ==> STILL OFF BY {Math.Abs(syncedFinal - clubWorker.LastClubsTotal)} — see the messages above (safety abort? skipped district? exempt district?).");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  (final count check failed: {ex.Message})");
        }

        Console.WriteLine("");
        Console.WriteLine("OK — club reconcile complete.");
        return 0;
    }

    if (mode == "--repair-sync")
    {
        var worker = sp.GetRequiredService<ClubSyncWorker>();
        await worker.RunRepairSyncAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — repair complete. Press any key to exit...");
        if (!Console.IsInputRedirected) Console.ReadKey();
        return 0;
    }

    if (mode == "--country-sync")
    {
        // --dry-run: fetch real data and print what WOULD change, but no DB writes and no email.
        // --club-id <RotaryClubId>: restrict the insert/update/soft-delete decisions to just that
        // one club (still fetches all 3 countries as normal — the search endpoint has no per-club
        // filter — but only acts on the requested ClubId). Combine both to safely inspect one club.
        bool dryRun = args.Skip(1).Any(a => string.Equals(a.Trim(), "--dry-run", StringComparison.OrdinalIgnoreCase));
        string? onlyClubId = null;
        for (int i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--club-id", StringComparison.OrdinalIgnoreCase))
                onlyClubId = args[i + 1].Trim();
        }

        var worker = sp.GetRequiredService<CountrySyncWorker>();
        await worker.RunAsync(cts.Token, dryRun: dryRun, onlyClubId: onlyClubId);
        Console.WriteLine("");
        Console.WriteLine(dryRun ? "OK — dry run complete (no changes were made)." : "OK — country sync complete.");
        return 0;
    }

    if (mode == "--terminate-clubs")
    {
        var flags = args.Skip(1).Select(a => a.Trim().ToLowerInvariant()).ToHashSet();
        bool apply = flags.Contains("--apply");
        bool force = flags.Contains("--force");
        var worker = sp.GetRequiredService<ClubTerminator>();
        await worker.RunAsync(apply, force, cts.Token);
        Console.WriteLine("");
        Console.WriteLine(apply ? "OK — termination APPLIED." : "OK — termination AUDIT complete (no DB changes).");
        if (!apply)
        {
            Console.WriteLine("");
            Console.WriteLine("Review the audit report. To actually cascade-delete, re-run with:");
            Console.WriteLine("  RotaryOrgSyncWorker.exe --terminate-clubs --apply");
        }
        // No "Press any key" so Task Scheduler can exit cleanly.
        return 0;
    }

    if (mode == "--non-sync-cascade")
    {
        var flags = args.Skip(1).Select(a => a.Trim().ToLowerInvariant()).ToHashSet();
        bool apply = flags.Contains("--apply");
        bool force = flags.Contains("--force");
        var worker = sp.GetRequiredService<ClubNonSyncCascadeWorker>();
        await worker.RunAsync(apply, force, cts.Token);
        Console.WriteLine("");
        Console.WriteLine(apply ? "OK — non-sync cascade APPLIED." : "OK — non-sync cascade AUDIT complete (no DB changes).");
        if (!apply)
        {
            Console.WriteLine("");
            Console.WriteLine("Review the audit report. To actually flip + cascade, re-run with:");
            Console.WriteLine("  RotaryOrgSyncWorker.exe --non-sync-cascade --apply");
        }
        return 0;
    }

    // DC "Club Presidents" / "Club Secretaries" groups = exact mirror of BOD (all years). AUDIT by default;
    // --apply fixes (soft-delete unbacked rows, add missing holders); --force bypasses the removal threshold.
    if (mode == "--dc-cpcs-reconcile")
    {
        var flags = args.Skip(1).Select(a => a.Trim().ToLowerInvariant()).ToHashSet();
        bool apply = flags.Contains("--apply");
        var reconciler = sp.GetRequiredService<DcCpcsReconciler>();
        var (removed, added) = await reconciler.RunAsync(apply, flags.Contains("--force"), cts.Token);
        Console.WriteLine("");
        Console.WriteLine(apply
            ? $"OK — DC CP/CS reconcile APPLIED ({removed} removed, {added} added)."
            : $"OK — DC CP/CS reconcile AUDIT complete ({removed} to remove, {added} to add; no DB changes).");
        return 0;
    }

    if (mode == "--website-orphan-cleanup")
    {
        // Soft-delete club_websites rows whose club is inactive / deleted / terminated / missing.
        // AUDIT by default; --apply soft-deletes (isdeleted=1, Status='Inactive'); --force bypasses
        // the safety threshold. Also runs (apply) automatically as the last step of --club-reconcile.
        var flags = args.Skip(1).Select(a => a.Trim().ToLowerInvariant()).ToHashSet();
        bool apply = flags.Contains("--apply");
        bool force = flags.Contains("--force");
        var worker = sp.GetRequiredService<ClubWebsiteOrphanCleanup>();
        await worker.RunAsync(apply, force, cts.Token);
        Console.WriteLine("");
        Console.WriteLine(apply ? "OK — website orphan cleanup APPLIED." : "OK — website orphan cleanup AUDIT complete (no DB changes).");
        if (!apply)
        {
            Console.WriteLine("");
            Console.WriteLine("Review the audit report. To actually soft-delete, re-run with:");
            Console.WriteLine("  RotaryOrgSyncWorker.exe --website-orphan-cleanup --apply");
        }
        return 0;
    }

    if (mode == "--list-districts")
    {
        var exporter = sp.GetRequiredService<DistrictListExporter>();
        await exporter.RunAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — district list exported. Press any key to exit...");
        if (!Console.IsInputRedirected) Console.ReadKey();
        return 0;
    }

    if (mode == "--list-world-districts")
    {
        var exporter = sp.GetRequiredService<WorldDistrictExporter>();
        await exporter.RunAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — world district list exported. Press any key to exit...");
        if (!Console.IsInputRedirected) Console.ReadKey();
        return 0;
    }

    if (mode == "--world-sync")
    {
        var worker = sp.GetRequiredService<WorldSyncWorker>();
        await worker.RunAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — world sync complete.");
        return 0;
    }

    if (mode == "--world-ensure")
    {
        var worker = sp.GetRequiredService<WorldEnsureWorker>();
        await worker.RunAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — world ensure complete.");
        return 0;
    }

    if (mode == "--world-clubs")
    {
        // Manual only (never scheduled). --dry-run = fetch + report, no DB writes.
        bool wcDryRun = args.Skip(1).Any(a => string.Equals(a.Trim(), "--dry-run", StringComparison.OrdinalIgnoreCase));
        var worker = sp.GetRequiredService<WorldClubImportWorker>();
        await worker.RunAsync(wcDryRun, cts.Token);
        Console.WriteLine("");
        Console.WriteLine(wcDryRun ? "OK — world clubs dry run complete (no changes were made)." : "OK — world clubs import complete.");
        return 0;
    }

    if (mode == "--member-sweep")
    {
        // --club-id NNN or --club-id NNN,NNN,NNN — accepts one or many
        // Rotary.org ClubRotaryIds (comma-separated), NOT internal pk_club_id.
        // The worker looks them up in club_master.ClubRotaryId; unmatched
        // values are reported and skipped.
        List<int>? sweepClubRotaryIds = null;
        List<string>? districtNumbers = null;
        string? failedListPath = null;
        for (int i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--club-id", StringComparison.OrdinalIgnoreCase))
            {
                sweepClubRotaryIds = args[i + 1]
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(v => int.TryParse(v, out var n) ? n : -1)
                    .Where(n => n > 0)
                    .Distinct()
                    .ToList();
            }
            // --districts 3233,3244,3220  (comma-separated DistrictNumber values).
            // Lets us batch the all-clubs sweep into smaller, safer runs.
            else if (string.Equals(args[i], "--districts", StringComparison.OrdinalIgnoreCase))
            {
                districtNumbers = args[i + 1]
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();
            }
            // --failed-list "C:\path\to\failed-members.xlsx"
            // Re-sync ONLY the (RotaryId, ClubRotaryId|ClubId) pairs in the file.
            // Skips termination pass. Use to retry the Errors sheet from a prior sweep
            // without re-running all 28 districts.
            else if (string.Equals(args[i], "--failed-list", StringComparison.OrdinalIgnoreCase))
            {
                failedListPath = args[i + 1];
            }
        }
        var worker = sp.GetRequiredService<ClubMemberSweepWorker>();
        if (!string.IsNullOrWhiteSpace(failedListPath))
        {
            await worker.RunForFailedListAsync(failedListPath, cts.Token);
            Console.WriteLine("");
            Console.WriteLine("OK — failed-list re-sync complete.");
        }
        else if (sweepClubRotaryIds != null && sweepClubRotaryIds.Count > 0)
        {
            // --club-id was passed (single or comma-separated ClubRotaryIds).
            // Full sweep (no time filter) restricted to those clubs.
            await worker.RunForClubRotaryIdsAsync(sweepClubRotaryIds, cts.Token);
            Console.WriteLine("");
            Console.WriteLine("OK — club member sweep complete.");
        }
        else
        {
            await worker.RunAsync(specificClubId: null, districtNumbers: districtNumbers, ct: cts.Token);
            Console.WriteLine("");
            Console.WriteLine("OK — club member sweep complete.");
        }
        return 0;
    }

    if (mode == "--member-daily-delta")
    {
        // --club-id 28046 or --club-id 28046,28047,28048 — run daily-delta
        // logic on just that/those club(s) (bypasses /clubs/updates gating).
        // Each value is treated as a ClubRotaryId; the worker resolves it to
        // pk_club_id internally. Useful to verify the 10-day admission-date
        // window would pick up specific members on specific clubs.
        List<int>? dailyDeltaClubIds = null;
        for (int i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--club-id", StringComparison.OrdinalIgnoreCase))
            {
                dailyDeltaClubIds = args[i + 1]
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(v => int.TryParse(v, out var n) ? n : -1)
                    .Where(n => n > 0)
                    .Distinct()
                    .ToList();
                break;
            }
        }
        var worker = sp.GetRequiredService<ClubMemberSweepWorker>();
        await worker.RunDailyDeltaAsync(dailyDeltaClubIds, cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — member daily delta complete.");
        return 0;
    }

    // MORNING mismatch-only member reconcile. Cheap /clubs-count filter → sweep ONLY sync clubs whose
    // ROW member count differs from the Rotary.org /clubs count (add missing + terminate gone,
    // profiles kept). Closes the drift --member-daily-delta can't see. Emails "Mismatch Member Sync".
    if (mode == "--member-count-reconcile")
    {
        // Optional --districts 3142,2982 — scope the reconcile to specific DistrictNumber(s).
        // Used by the club-page "Sync all mismatched — this district" button. No flag = all districts.
        List<string>? rcDistricts = null;
        for (int i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--districts", StringComparison.OrdinalIgnoreCase))
            {
                rcDistricts = args[i + 1]
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();
                break;
            }
        }
        var worker = sp.GetRequiredService<ClubMemberSweepWorker>();
        await worker.RunMemberCountReconcileAsync(rcDistricts, cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — member count reconcile complete.");
        return 0;
    }

    if (mode == "--joindate-sync")
    {
        // Lightweight JOINING-DATE-ONLY sync. Updates ONLY club_members.JoinedDate from
        // Rotary.org AdmissionDate — no profile fetch, no add, no terminate. Optional filters:
        //   --club-id 86427[,NNN,...]   one/many ClubRotaryIds
        //   --districts 3233[,3244,...] one/many DistrictNumbers
        //   --no-honorary               skip the honorary members call (active list only)
        //   --concurrency N             clubs processed in parallel (default 6)
        var jdClubIdSet = new HashSet<int>();
        List<string>? jdDistricts = null;
        bool includeHonorary = true;
        int concurrency = 6;
        // Split ClubRotaryIds on comma / newline / whitespace / semicolon — tolerates the
        // messy file shape (trailing commas, blank entries, one-or-many per line).
        static IEnumerable<int> ParseClubIds(string text) => text
            .Split(new[] { ',', '\n', '\r', '\t', ' ', ';' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(v => int.TryParse(v.Trim(), out var n) ? n : -1)
            .Where(n => n > 0);
        for (int i = 1; i < args.Length; i++)
        {
            if (string.Equals(args[i], "--no-honorary", StringComparison.OrdinalIgnoreCase))
                includeHonorary = false;
            else if (i < args.Length - 1 && string.Equals(args[i], "--club-id", StringComparison.OrdinalIgnoreCase))
                foreach (var n in ParseClubIds(args[i + 1])) jdClubIdSet.Add(n);
            // --club-id-file "C:\path\ids.txt" — read ClubRotaryIds from a file (any mix of
            // comma / newline separators, blanks ignored). Great for bulk runs of hundreds.
            else if (i < args.Length - 1 && string.Equals(args[i], "--club-id-file", StringComparison.OrdinalIgnoreCase))
            {
                var path = args[i + 1];
                if (!System.IO.File.Exists(path))
                {
                    Console.WriteLine($"--club-id-file: file not found: {path}");
                    return 1;
                }
                foreach (var n in ParseClubIds(System.IO.File.ReadAllText(path))) jdClubIdSet.Add(n);
                Console.WriteLine($"--club-id-file: loaded {jdClubIdSet.Count} unique ClubRotaryId(s) from {path}");
            }
            else if (i < args.Length - 1 && string.Equals(args[i], "--districts", StringComparison.OrdinalIgnoreCase))
                jdDistricts = args[i + 1]
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();
            else if (i < args.Length - 1 && string.Equals(args[i], "--concurrency", StringComparison.OrdinalIgnoreCase)
                     && int.TryParse(args[i + 1], out var c) && c > 0)
                concurrency = c;
        }
        var jdClubRotaryIds = jdClubIdSet.Count > 0 ? jdClubIdSet.ToList() : null;
        var worker = sp.GetRequiredService<ClubMemberSweepWorker>();
        await worker.RunJoinDateSyncAsync(jdClubRotaryIds, jdDistricts, includeHonorary, concurrency, cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — joining-date sync complete.");
        return 0;
    }

    if (mode == "--dedup-norid")
    {
        // No-RotaryId dedup. AUDIT by default (dry run); add --apply to write. Optional --districts filter.
        //   RotaryOrgSyncWorker.exe --dedup-norid                 (audit, all synced clubs)
        //   RotaryOrgSyncWorker.exe --dedup-norid --apply         (apply, all synced clubs)
        //   RotaryOrgSyncWorker.exe --dedup-norid --districts 3070 --apply
        bool ddApply = args.Any(a => string.Equals(a, "--apply", StringComparison.OrdinalIgnoreCase));
        List<string>? ddDistricts = null;
        for (int i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--districts", StringComparison.OrdinalIgnoreCase))
            {
                ddDistricts = args[i + 1].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
                break;
            }
        }
        var worker = sp.GetRequiredService<ClubMemberSweepWorker>();
        await worker.RunDedupNoRidAsync(ddApply, ddDistricts, cts.Token);
        Console.WriteLine("");
        Console.WriteLine(ddApply ? "OK — no-RotaryId dedup applied." : "OK — no-RotaryId dedup audit complete (dry run).");
        return 0;
    }

    if (mode == "--member-refresh")
    {
        // SINGLE-MEMBER verify/fix: --member-id 6013684[,8211271,...] — refresh DOB + JoinedDate for
        // one/many members and print before→after. Use to confirm on the server before the bulk run.
        var refreshIds = new List<long>();
        for (int i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--member-id", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var v in args[i + 1].Split(new[] { ',', ' ', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    if (long.TryParse(v, out var n) && n > 0) refreshIds.Add(n);
                break;
            }
        }
        if (refreshIds.Count == 0)
        {
            Console.Error.WriteLine("Usage: RotaryOrgSyncWorker.exe --member-refresh --member-id <RotaryId>[,<RotaryId>,...]");
            Console.Error.WriteLine("Example: RotaryOrgSyncWorker.exe --member-refresh --member-id 6013684");
            return 1;
        }
        var worker = sp.GetRequiredService<ClubMemberSweepWorker>();
        await worker.RunMemberRefreshAsync(refreshIds, cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — single-member refresh complete.");
        return 0;
    }

    if (mode == "--dob-sync")
    {
        // Lightweight DATE-OF-BIRTH-ONLY sync. Updates ONLY member_master_profile.BirthDate from
        // Rotary.org /individuals/{id}, parsed correctly as MM/dd/yyyy — no add, no terminate. Fixes
        // the historical day/month-swap + year-1900 DOBs. Optional filters (same shape as --joindate-sync):
        //   --club-id 86427[,NNN,...]   one/many ClubRotaryIds
        //   --club-id-file "C:\path\ids.txt"
        //   --districts 3233[,3244,...] one/many DistrictNumbers
        //   --concurrency N             members processed in parallel (default 6)
        //   (no filter = every member with a RotaryId)
        var dobClubIdSet = new HashSet<int>();
        List<string>? dobDistricts = null;
        int dobConcurrency = 6;
        static IEnumerable<int> ParseDobClubIds(string text) => text
            .Split(new[] { ',', '\n', '\r', '\t', ' ', ';' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(v => int.TryParse(v.Trim(), out var n) ? n : -1)
            .Where(n => n > 0);
        for (int i = 1; i < args.Length; i++)
        {
            if (i < args.Length - 1 && string.Equals(args[i], "--club-id", StringComparison.OrdinalIgnoreCase))
                foreach (var n in ParseDobClubIds(args[i + 1])) dobClubIdSet.Add(n);
            else if (i < args.Length - 1 && string.Equals(args[i], "--club-id-file", StringComparison.OrdinalIgnoreCase))
            {
                var path = args[i + 1];
                if (!System.IO.File.Exists(path)) { Console.WriteLine($"--club-id-file: file not found: {path}"); return 1; }
                foreach (var n in ParseDobClubIds(System.IO.File.ReadAllText(path))) dobClubIdSet.Add(n);
                Console.WriteLine($"--club-id-file: loaded {dobClubIdSet.Count} unique ClubRotaryId(s) from {path}");
            }
            else if (i < args.Length - 1 && string.Equals(args[i], "--districts", StringComparison.OrdinalIgnoreCase))
                dobDistricts = args[i + 1]
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();
            else if (i < args.Length - 1 && string.Equals(args[i], "--concurrency", StringComparison.OrdinalIgnoreCase)
                     && int.TryParse(args[i + 1], out var c) && c > 0)
                dobConcurrency = c;
        }
        var dobClubRotaryIds = dobClubIdSet.Count > 0 ? dobClubIdSet.ToList() : null;
        var worker = sp.GetRequiredService<ClubMemberSweepWorker>();
        await worker.RunDobSyncAsync(dobClubRotaryIds, dobDistricts, dobConcurrency, cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — date-of-birth sync complete.");
        return 0;
    }

    if (mode == "--bod-subgroup-sync")
    {
        var worker = sp.GetRequiredService<BodSubGroupSyncWorker>();
        await worker.RunAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — BOD sub-group sync complete.");
        return 0;
    }

    // Single-club address / day / time refresh from Rotary.org — added 2026-07-10
    // to let admins test the "Meeting Location" fix on a specific club without
    // running the full --delta sweep. Only touches MeetingAddress, MeetingDay,
    // MeetingFromTime, Country/State/City/Pincode — no members / BOD / roles.
    if (mode == "--club-sync")
    {
        int? singleClubRotaryId = null;
        for (int i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--club-id", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(args[i + 1], out var cid))
            {
                singleClubRotaryId = cid;
                break;
            }
        }
        if (!singleClubRotaryId.HasValue)
        {
            Console.Error.WriteLine("Usage: RotaryOrgSyncWorker.exe --club-sync --club-id <ClubRotaryId>");
            Console.Error.WriteLine("Example: RotaryOrgSyncWorker.exe --club-sync --club-id 28046");
            Console.Error.WriteLine("For ALL clubs use: RotaryOrgSyncWorker.exe --bootstrap");
            return 1;
        }

        var clubRid = singleClubRotaryId.Value;
        var connStr = config.GetConnectionString("DefaultConnection")!;
        var apiClient = sp.GetRequiredService<IRotaryOrgApiClient>();

        // 1. Look up local club by ClubRotaryId
        await using var conn = new MySqlConnector.MySqlConnection(connStr);
        await conn.OpenAsync(cts.Token);
        var existing = await Dapper.SqlMapper.QueryFirstOrDefaultAsync<(int pk_id, string? ClubName, string? MeetingAddress, string? MeetingDay, TimeSpan? MeetingFromTime)>(
            conn,
            "SELECT pk_club_id AS pk_id, ClubName, MeetingAddress, MeetingDay, MeetingFromTime FROM club_master WHERE ClubRotaryId = @Rid LIMIT 1",
            new { Rid = clubRid.ToString() });
        if (existing.pk_id == 0)
        {
            Console.Error.WriteLine($"Club with ClubRotaryId={clubRid} not found in club_master.");
            return 2;
        }
        Console.WriteLine($"\nBEFORE:");
        Console.WriteLine($"  ClubName        = {existing.ClubName}");
        Console.WriteLine($"  MeetingAddress  = {existing.MeetingAddress}");
        Console.WriteLine($"  MeetingDay      = {existing.MeetingDay}");
        Console.WriteLine($"  MeetingFromTime = {existing.MeetingFromTime}");

        // 2. Fetch from Rotary.org
        RotaryOrgSyncWorker.Services.RotaryOrgClubDetailDto? detail;
        try { detail = await apiClient.GetClubDetailAsync("Rotary Club", clubRid, cts.Token); }
        catch (Exception ex) { Console.Error.WriteLine($"Rotary.org API error: {ex.Message}"); return 3; }
        if (detail == null) { Console.Error.WriteLine("Club not found on Rotary.org."); return 4; }

        // 3. Meeting Location ONLY — no fallback
        var addr = detail.Addresses?.FirstOrDefault(a => string.Equals(a.AddressType, "Meeting Location", StringComparison.OrdinalIgnoreCase));
        var meetingAddress = addr == null ? null : string.Join(", ",
            new[] { addr.MeetingName, addr.AddressLine1, addr.AddressLine2, addr.AddressLine3 }
                .Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));
        string? NormalizeDay(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var t = raw.Trim();
            return t.ToLowerInvariant() switch
            {
                "mon" or "monday" => "Monday",
                "tue" or "tues" or "tuesday" => "Tuesday",
                "wed" or "weds" or "wednesday" => "Wednesday",
                "thu" or "thur" or "thurs" or "thursday" => "Thursday",
                "fri" or "friday" => "Friday",
                "sat" or "saturday" => "Saturday",
                "sun" or "sunday" => "Sunday",
                _ => t,
            };
        }
        TimeSpan? ParseHHMM(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var t = raw.Trim();
            if (t.Length == 4 && t.All(char.IsDigit))
            {
                var hh = int.Parse(t[..2]); var mm = int.Parse(t[2..]);
                if (hh < 24 && mm < 60) return new TimeSpan(hh, mm, 0);
            }
            if (t.Length == 3 && t.All(char.IsDigit))
            {
                var hh = int.Parse(t[..1]); var mm = int.Parse(t[1..]);
                if (hh < 24 && mm < 60) return new TimeSpan(hh, mm, 0);
            }
            if (TimeSpan.TryParse(t, System.Globalization.CultureInfo.InvariantCulture, out var ts) && ts.TotalHours >= 0 && ts.TotalHours < 24) return ts;
            if (DateTime.TryParse(t, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt)) return dt.TimeOfDay;
            return null;
        }
        var meetingDay = NormalizeDay(addr?.MeetingDay);
        var meetingFromTime = ParseHHMM(addr?.MeetingTime);
        var state = RotaryOrgSyncWorker.Services.IndianStateResolver.NormalizeForCountry(addr?.State, addr?.Country);

        Console.WriteLine($"\nFROM ROTARY.ORG (AddressType='Meeting Location'):");
        Console.WriteLine($"  MeetingName    = {addr?.MeetingName}");
        Console.WriteLine($"  AddressLine1   = {addr?.AddressLine1}");
        Console.WriteLine($"  AddressLine2   = {addr?.AddressLine2}");
        Console.WriteLine($"  AddressLine3   = {addr?.AddressLine3}");
        Console.WriteLine($"  MeetingDay raw = {addr?.MeetingDay}");
        Console.WriteLine($"  MeetingTime raw= {addr?.MeetingTime}");
        Console.WriteLine($"  Country raw    = {addr?.Country}");
        Console.WriteLine($"  State raw      = {addr?.State}");
        Console.WriteLine();
        Console.WriteLine($"  → MeetingAddress = {meetingAddress}");
        Console.WriteLine($"  → MeetingDay     = {meetingDay}");
        Console.WriteLine($"  → MeetingFromTime= {meetingFromTime}");
        Console.WriteLine($"  → State          = {state}");

        // 4. UPDATE via COALESCE — blank Rotary.org values keep existing DB values.
        await Dapper.SqlMapper.ExecuteAsync(conn, @"
            UPDATE club_master SET
                MeetingAddress  = COALESCE(@MeetingAddress, MeetingAddress),
                MeetingDay      = COALESCE(@MeetingDay,     MeetingDay),
                MeetingFromTime = COALESCE(@MeetingFromTime, MeetingFromTime),
                State           = COALESCE(@State,          State),
                LastSyncedFromRotaryOrg = NOW(),
                modified_date = NOW()
            WHERE pk_club_id = @Id",
            new { Id = existing.pk_id, MeetingAddress = meetingAddress, MeetingDay = meetingDay, MeetingFromTime = meetingFromTime, State = state });

        var after = await Dapper.SqlMapper.QueryFirstAsync<(string? MeetingAddress, string? MeetingDay, TimeSpan? MeetingFromTime, string? State)>(
            conn, "SELECT MeetingAddress, MeetingDay, MeetingFromTime, State FROM club_master WHERE pk_club_id = @Id",
            new { Id = existing.pk_id });

        Console.WriteLine($"\nAFTER:");
        Console.WriteLine($"  MeetingAddress  = {after.MeetingAddress}");
        Console.WriteLine($"  MeetingDay      = {after.MeetingDay}");
        Console.WriteLine($"  State           = {after.State}");
        Console.WriteLine($"  MeetingFromTime = {after.MeetingFromTime}");
        Console.WriteLine("\nOK — club sync complete.");
        return 0;
    }

    // Bulk one-time fix of every India-country club's State column. Uses
    // IndianStateResolver.Normalize on every non-empty State value; UPDATE only
    // if the canonical form differs. Idempotent — safe to run multiple times.
    if (mode == "--normalize-states")
    {
        var connStrN = config.GetConnectionString("DefaultConnection")!;
        await using var connN = new MySqlConnector.MySqlConnection(connStrN);
        await connN.OpenAsync(cts.Token);

        // Only clubs where Country identifies India — non-India clubs untouched.
        var rows = (await Dapper.SqlMapper.QueryAsync<(int pk_id, string? country, string? state)>(connN,
            @"SELECT pk_club_id AS pk_id, Country AS country, State AS state
              FROM club_master
              WHERE isdeleted = 0
                AND State IS NOT NULL AND State <> ''
                AND (Country IS NULL OR Country = '' OR Country IN ('India','IN','IND','Bharat'))")).ToList();

        Console.WriteLine($"Scanned {rows.Count} India-country clubs with a non-empty State value.");
        int updated = 0, unchanged = 0;
        var unknownExamples = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
        {
            var canonical = RotaryOrgSyncWorker.Services.IndianStateResolver.Normalize(r.state);
            // canonical == r.state → nothing to write (already canonical, no whitespace to trim)
            if (string.Equals(canonical, r.state, StringComparison.Ordinal))
            {
                unchanged++;
                continue;
            }
            // canonical differs from raw → write the fix. Also record unknowns
            // for reporting (canonical equals the trimmed raw = no map hit).
            if (string.Equals(canonical, r.state?.Trim(), StringComparison.Ordinal))
                unknownExamples.Add(r.state!.Trim());
            await Dapper.SqlMapper.ExecuteAsync(connN,
                "UPDATE club_master SET State = @S, modified_date = NOW() WHERE pk_club_id = @Id",
                new { S = canonical, Id = r.pk_id });
            updated++;
        }
        Console.WriteLine("");
        Console.WriteLine($"OK — State normalization complete.");
        Console.WriteLine($"  updated   = {updated}");
        Console.WriteLine($"  unchanged = {unchanged} (already canonical)");
        if (unknownExamples.Count > 0)
        {
            Console.WriteLine($"  unknown values seen (kept as-is, no map hit — please review):");
            foreach (var u in unknownExamples.OrderBy(x => x)) Console.WriteLine($"    - {u}");
        }
        return 0;
    }

    if (mode == "--bod-sync")
    {
        int? bodSpecificClubRotaryId = null;   // ClubRotaryId (e.g. 28046), NOT internal pk_club_id
        // --recent: sync only LAST / CURRENT / FUTURE Rotary years (skip old history). The weekly
        // scheduled run stays full (all years charter->current+2).
        bool bodRecentOnly = args.Skip(1).Any(a => string.Equals(a, "--recent", StringComparison.OrdinalIgnoreCase));
        for (int i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--club-id", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(args[i + 1], out var cid))
            {
                bodSpecificClubRotaryId = cid;
                break;
            }
        }
        var bodWorker = sp.GetRequiredService<BodSyncWorker>();
        await bodWorker.RunAsync(bodSpecificClubRotaryId, bodRecentOnly, cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — BOD sync complete.");
        return 0;
    }

    if (mode == "--probe-club-officers")
    {
        if (args.Length < 2 || !int.TryParse(args[1], out var officerProbeId))
        {
            Console.Error.WriteLine("Usage: RotaryOrgSyncWorker.exe --probe-club-officers <ClubRotaryId> [fromYear]");
            Console.Error.WriteLine("Example: RotaryOrgSyncWorker.exe --probe-club-officers 28046 2024");
            return 1;
        }
        var fromYear = (args.Length >= 3 && int.TryParse(args[2], out var y)) ? y : DateTime.Today.Year - 1;
        var toYear = fromYear + 1;
        var path = $"clubs/Rotary%20Club/{officerProbeId}/officers?startDate=07/01/{fromYear}&endDate=06/30/{toYear}";
        Console.WriteLine($"\nProbing /{path}\n");
        var apiClient = sp.GetRequiredService<IRotaryOrgApiClient>();
        try
        {
            var (status, body) = await apiClient.GetRawAsync(path, cts.Token);
            Console.WriteLine($"HTTP {status}");
            Console.WriteLine($"Body length: {body.Length} chars");
            Console.WriteLine("--- BODY ---");
            Console.WriteLine(body.Length > 12000 ? body.Substring(0, 12000) + "\n...[truncated]" : body);
            Console.WriteLine("--- END ---");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"FAILED: {ex.Message}");
        }
        return 0;
    }

    if (mode == "--probe-club-members")
    {
        if (args.Length < 2 || !int.TryParse(args[1], out var probeId))
        {
            Console.Error.WriteLine("Usage: RotaryOrgSyncWorker.exe --probe-club-members <ClubRotaryId>");
            Console.Error.WriteLine("Example: RotaryOrgSyncWorker.exe --probe-club-members 28046");
            return 1;
        }
        var api = sp.GetRequiredService<IRotaryOrgApiClient>();

        // Try several URL variations to discover the correct endpoint shape.
        var candidates = new (string Label, string Path)[]
        {
            ("v1: /clubs/{type}/{id}/members (no params)", $"clubs/Rotary%20Club/{probeId}/members"),
            ("v2: /clubs/{type}/{id}/members?startDate=01-01-2020&endDate=12-31-2030", $"clubs/Rotary%20Club/{probeId}/members?startDate=01-01-2020&endDate=12-31-2030"),
            ("v3: /clubs/{id}/members (no type)", $"clubs/{probeId}/members"),
            ("v4: /clubs/{type}/{id}/individuals", $"clubs/Rotary%20Club/{probeId}/individuals"),
            ("v5: /clubs/{type}/{id}/membership", $"clubs/Rotary%20Club/{probeId}/membership"),
            ("v6: /clubs/{type}/{id}/memberships", $"clubs/Rotary%20Club/{probeId}/memberships"),
            ("v7: /clubs/{type}/{id}/individuals?startDate=01-01-2020&endDate=12-31-2030", $"clubs/Rotary%20Club/{probeId}/individuals?startDate=01-01-2020&endDate=12-31-2030"),
            ("v8: /individuals?clubId={id}", $"individuals?clubId={probeId}"),
            ("v9: /clubs/{type}/{id}/active-members", $"clubs/Rotary%20Club/{probeId}/active-members"),
            ("v10: /clubs/{type}/{id}?summary=false (whole club detail)", $"clubs/Rotary%20Club/{probeId}?summary=false"),
        };

        Console.WriteLine($"\nProbing {candidates.Length} URL variations for ClubRotaryId={probeId}\n");

        foreach (var c in candidates)
        {
            try
            {
                var (status, body) = await api.GetRawAsync(c.Path, cts.Token);
                var snippet = body.Length > 0 ? (body.Length > 200 ? body.Substring(0, 200) + "..." : body) : "(empty)";
                Console.WriteLine($"  HTTP {status,3}  {c.Label}");
                Console.WriteLine($"           body[{body.Length}]: {snippet}");
                Console.WriteLine();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"  ERR       {c.Label}");
                Console.WriteLine($"           {ex.Message}");
                Console.WriteLine();
            }
        }

        // FULL BODY of the actual member list endpoint:
        // GET /clubs/Rotary Club/{clubId}/members/{offset}/{limit}/Active
        Console.WriteLine("");
        Console.WriteLine("===================================================================");
        Console.WriteLine($"FULL BODY of /clubs/Rotary Club/{probeId}/members/0/1500/Active");
        Console.WriteLine("===================================================================");
        try
        {
            var (s, b) = await api.GetRawAsync($"clubs/Rotary%20Club/{probeId}/members/0/1500/Active", cts.Token);
            Console.WriteLine($"HTTP {s}");
            Console.WriteLine($"Body length: {b.Length} chars");
            Console.WriteLine(b.Length > 8000 ? b.Substring(0, 8000) + "\n...[truncated]" : b);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"ERROR: {ex.Message}");
        }
        Console.WriteLine("===================================================================");

        // FULL BODY of /individuals/{memberId}/profile — pick first member from the list above
        Console.WriteLine("");
        Console.WriteLine("===================================================================");
        Console.WriteLine($"FULL BODY of /individuals/11841458/profile  (sample member)");
        Console.WriteLine("===================================================================");
        try
        {
            var (s2, b2) = await api.GetRawAsync($"individuals/11841458/profile", cts.Token);
            Console.WriteLine($"HTTP {s2}");
            Console.WriteLine($"Body length: {b2.Length} chars");
            Console.WriteLine(b2.Length > 8000 ? b2.Substring(0, 8000) + "\n...[truncated]" : b2);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"ERROR: {ex.Message}");
        }
        Console.WriteLine("===================================================================");
        return 0;
    }

    if (mode == "--diagnose-district")
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: RotaryOrgSyncWorker.exe --diagnose-district <DistrictNumber>");
            Console.Error.WriteLine("Example: RotaryOrgSyncWorker.exe --diagnose-district 3142");
            return 1;
        }
        var district = args[1].Trim();
        var diagnoser = sp.GetRequiredService<DistrictDiagnoser>();
        await diagnoser.RunAsync(district, cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — diagnosis complete. Press any key to exit...");
        if (!Console.IsInputRedirected) Console.ReadKey();
        return 0;
    }

    if (mode == "--diagnose-all")
    {
        var diagnoser = sp.GetRequiredService<DistrictDiagnoser>();
        await diagnoser.RunAllAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — diagnose-all complete. Press any key to exit...");
        if (!Console.IsInputRedirected) Console.ReadKey();
        return 0;
    }

    if (mode == "--export-district")
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: RotaryOrgSyncWorker.exe --export-district <DistrictNumber>");
            Console.Error.WriteLine("Example: RotaryOrgSyncWorker.exe --export-district 3142");
            return 1;
        }
        var district = args[1].Trim();
        var diagnoser = sp.GetRequiredService<DistrictDiagnoser>();
        await diagnoser.ExportDistrictAsync(district, cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — export complete. Press any key to exit...");
        if (!Console.IsInputRedirected) Console.ReadKey();
        return 0;
    }

    if (mode == "--export-all")
    {
        var diagnoser = sp.GetRequiredService<DistrictDiagnoser>();
        await diagnoser.ExportAllAsync(cts.Token);
        Console.WriteLine("");
        Console.WriteLine("OK — export-all complete. Press any key to exit...");
        if (!Console.IsInputRedirected) Console.ReadKey();
        return 0;
    }

    if (mode == "--resend-report")
    {
        int? targetLogId = null;
        if (args.Length > 1 && int.TryParse(args[1], out var parsedId))
            targetLogId = parsedId;
        var resender = sp.GetRequiredService<ReportResender>();
        await resender.RunAsync(targetLogId, cts.Token);
        return 0;
    }

    if (mode == "--ping")
    {
        var api = sp.GetRequiredService<IRotaryOrgApiClient>();
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Pinging Rotary.org...");
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var clubs = await api.GetClubsAsync(cts.Token);
        sw.Stop();
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] OK — fetched {clubs.Count} clubs in {sw.ElapsedMilliseconds}ms");
        if (clubs.Count > 0)
        {
            var c = clubs[0];
            Console.WriteLine($"  Sample: ClubId={c.ClubId} Name={c.ClubName} District={c.DistrictId}");
        }
        return 0;
    }

    Console.Error.WriteLine($"Unknown mode: {mode}");
    return 1;
}
catch (OperationCanceledException)
{
    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Cancelled by user.");
    return 130;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] FAILED: {ex.Message}");
    Console.Error.WriteLine(ex.StackTrace);
    return 2;
}
