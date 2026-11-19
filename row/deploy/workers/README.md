# ROW background workers on the server

The workers are console programs run by Windows Task Scheduler. As of 2026-11-18 none of them ran on the server
(no greetings, Rotary.org sync last ran 30 Oct). This folder builds them and sets them up.

## 1. Build (dev PC)

```powershell
powershell -ExecutionPolicy Bypass -File row\deploy\workers\build-workers.ps1
```

Output: `E:\websites\row\_local\deploy\workers\` with `GreetingsWorker`, `AwardsAutoCalcWorker`,
`RotaryOrgSyncWorker`, `RccGoalsFetcher`, this README and `setup-workers.ps1`. It contains no secrets (the script
removes secret files and stops if a secret value is found).

## 2. Upload

Copy the whole folder to the server, for example `D:\ROW\workers\`. On later updates, upload the same way: the
server's `appsettings.secrets.json` files are never in the upload, so they survive.

## 3. Set up (server, elevated PowerShell, in the uploaded folder)

Preview, writes nothing:

```powershell
.\setup-workers.ps1 -ApiWebConfig 'D:\Inetpub\vhosts\rosteronwheels.com\test.rosteronwheels.com\api\web.config' -WhatIf
```

The preview lists how many settings each worker gets from the API and names any that are MISSING (for example the
Brevo key, which the API also needs for email). Then run the same line without `-WhatIf`. It:

- writes `appsettings.secrets.json` into each worker folder from the API's `<environmentVariables>` (connection
  string, Brevo, Brand, Rotary.org login), readable only by SYSTEM and Administrators;
- registers tasks under `\ROW\` running as SYSTEM: **Greetings Hourly** (`--send`; each club greets at its own
  08:00) and **District Citation Nightly** (`--district-citation`, 02:30).

After changing the API's settings, refresh the workers' copy with `-SecretsOnly` (tasks are left alone).

Check a task by hand once: `Start-ScheduledTask -TaskPath '\ROW\' -TaskName 'Greetings Hourly'`, then look at
`greeting_send_log`. `GreetingsWorker.exe --dry-run` shows who would be greeted without sending.

## 4. Rotary.org sync (owner decision)

Not set up unless you add `-RotarySync`. Choose the modes with `-SyncModes`. What each one changes:

| Mode | Time | What it does |
|---|---|---|
| `--delta` | 01:30 | Updates clubs that changed on Rotary.org |
| `--repair-sync` | 02:00 | Adds synced clubs missing from the database |
| `--club-reconcile` | 02:15 | Full club pass; clubs that stopped syncing are moved to non-sync and their members soft-deleted (guarded by `RotaryOrgSync:MaxAutoNonSyncPerRun`) |
| `--member-sync` | 02:45 | Adds, updates and terminates members to match Rotary.org |
| `--member-daily-delta` | 03:00 | Member changes since yesterday only |
| `--bod-sync` | 03:30 | Board of directors / officers |
| `--country-sync` | 04:30 | Nightly sync of every synced country except India |

Suggested start: `-RotarySync -SyncModes '--delta','--member-sync'`, and run `--club-reconcile --no-down` by hand
first to see what it would change. Modes ending in `--apply` (terminate clubs, non-sync cascade, website orphan
cleanup) are never scheduled by this script. Rotary International's data-integration partner status is a separate
open question.

The API's "sweep" and "reconcile" buttons start the worker through the API setting `RotaryOrgSync__WorkerExePath`;
set it in `api\web.config` to `D:\ROW\workers\RotaryOrgSyncWorker\RotaryOrgSyncWorker.exe` if you want them to work.

## 5. RCC goals worker (optional)

`-RccWorker` writes its secrets and registers **RCC Goals Worker** (`--worker`, at startup), the poller that runs
District Governors' "Sync" requests. It needs a browser on the server; read `RccGoalsFetcher\WORKER_SETUP.md` first.

The AI assistant index worker is not included: the assistant is switched off.
