# RccGoalsFetcher worker: District Governor syncs

`RccGoalsFetcher.exe --worker` is a long-running loop. It is separate from the normal all-districts run.

- The web API queues rows in `rotary_org_sync_requests`, either MANUAL (a DG pressed Sync) or NIGHTLY.
- The worker takes one request at a time. It never runs two Rotary.org sign-ins at once, and only one worker can run per machine.
- It signs in with that DG's own Rotary.org login, which is either saved in `rotary_org_sync_logins` or given once on the request.
- It fetches only that district, only the current Rotary year and only Rotary clubs.
- It writes the results to `goal_rotary_org_values`:
  - A Target is inserted only if it is missing. An existing target is never changed.
  - Achieved and Value rows are inserted or updated on every sync.
  - Nothing is ever deleted.
- Each day at `RotaryOrgSync:NightlyHour` (local time, default 01:00) on `RotaryOrgSync:WeeklyDay` (default Sunday) it queues one request (TriggerType NIGHTLY) per saved login that allows auto-sync - i.e. auto-sync is WEEKLY on a fixed day (skipped for a district synced in the last 12 h). Every day it also disables logins saved for an earlier Rotary year.
- Both tables are created on start if they are missing (`CREATE TABLE IF NOT EXISTS`).
- Log: `<Output:Folder>\logs\RccWorker_yyyy-MM-dd.log` (one file per day).

## Requirements
- **Microsoft Edge must be installed** on the server, because `Rcc:BrowserChannel` = `msedge`. Run `playwright.ps1 install` once only if you switch to Playwright's own Chromium.
- In `appsettings.secrets.json` next to the exe (never committed):
  ```json
  {
    "ConnectionStrings": { "DefaultConnection": "Server=localhost;..." },
    "RotaryOrgSync": { "CredentialKey": "<base64 of 32 bytes>" },
    "Brevo": { "ApiKey": "..." }
  }
  ```
  - **`RotaryOrgSync:CredentialKey` must be exactly the same value as the API's `RotaryOrgSync:CredentialKey`.** Saved passwords use AES-256-GCM. With a different key, every request fails with "password could not be read".
  - `Brevo:ApiKey` sends the single "your Rotary.org password stopped working" mail.
  - The worker does not use `Rcc:Email` / `Rcc:Password`.
- Optional settings in `appsettings.json`: `RotaryOrgSync:NightlyHour` (0-23), `RotaryOrgSync:WeeklyDay` (Sunday..Saturday) and `RotaryOrgSync:PollSeconds` (default 20).

## Install as a Windows Service (elevated command prompt)
```bat
sc.exe create RccGoalsWorker binPath= "D:\RccGoalsFetcher\RccGoalsFetcher.exe --worker" start= auto DisplayName= "RIZones - Rotary.org goals worker"
sc.exe description RccGoalsWorker "District Governor Rotary Club Central syncs queued from RIZones (RccGoalsFetcher --worker)"
sc.exe failure RccGoalsWorker reset= 86400 actions= restart/60000/restart/60000/restart/300000
sc.exe start RccGoalsWorker
```
Use the real exe path. `sc.exe` needs the space after each `=`.

- The service runs as LocalSystem by default. If Edge will not start headless under LocalSystem, run the service as a normal Windows user. Set that with `sc.exe config RccGoalsWorker obj= ".\user" password= "..."`, or in services.msc under Log On.
- To stop: `sc.exe stop RccGoalsWorker`. To remove: `sc.exe delete RccGoalsWorker`.
- To run in a console for testing, run `RccGoalsFetcher.exe --worker` and stop it with Ctrl+C. Add `--show-browser` to watch the sign-in. Stop the service first, because only one worker runs per machine.

## Statuses
- **Request:** QUEUED -> RUNNING -> DONE / FAILED / LOGIN_FAILED.
  - While a request runs, `Stage`, `ClubsDone` and `ClubsTotal` show progress.
  - A request still RUNNING after 2 hours is marked FAILED ("worker restarted").
  - `OneTimeEmail` / `OneTimePasswordEnc` are wiped as soon as they are read, and again at the end.
- **Saved login:**
  - OK after a good sync.
  - EXPIRED when Rotary.org refuses the email or password. The DG gets one mail, and the worker never retries until the API saves a new password and resets the status.
  - MFA when Rotary.org asks for a verification code.
  - DISABLED when the login is from an earlier Rotary year. The new DG must save their own.

## The normal scheduled run is separate
The existing scheduled task (`RccGoalsFetcher.exe` with no `--worker`) still downloads all districts of the configured zones with the `Rcc:Email` account to Excel. It keeps its own checkpoint folder. The worker does not read or write that checkpoint folder. The two can be installed side by side.

## Checking the database mapping (read-only)
```bat
RccGoalsFetcher.exe --validate-excel D:\RccGoals\RCC_Goals_2026-27_2026-10-28.xlsx --districts 3142,3141 [--source "RCC fetch 2026-10-28"]
```
This builds the database rows from an Excel with the same mapping code the worker uses (`DbWriter.BuildRows`). It then compares them with the rows already in `goal_rotary_org_values` for that Source and reports matches, missing rows, extra rows and value differences. It writes nothing.
