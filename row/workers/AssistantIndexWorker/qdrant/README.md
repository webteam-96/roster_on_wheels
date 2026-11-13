# Qdrant + AssistantIndexWorker — Windows server setup

The AI assistant (`RotaryApi/Services/Assistant/`) searches two Qdrant collections, `rotary_projects`
and `rotary_comms`. `AssistantIndexWorker` fills them from MySQL every night. Qdrant runs on the same
server as the API, bound to 127.0.0.1, as a Windows service (WinSW).

Paths below assume `D:\Qdrant`. If you use another folder, change it in `config.yaml` and
`qdrant-service.xml` too.

## 1. Install Qdrant v1.20.0

1. Download `qdrant-x86_64-pc-windows-msvc.zip` from the v1.20.0 GitHub release:
   <https://github.com/qdrant/qdrant/releases/tag/v1.20.0>
2. Create the folders and unpack:
   ```powershell
   New-Item -ItemType Directory -Force D:\Qdrant\config, D:\Qdrant\storage, D:\Qdrant\snapshots, D:\Qdrant\logs
   Expand-Archive .\qdrant-x86_64-pc-windows-msvc.zip -DestinationPath D:\Qdrant   # gives D:\Qdrant\qdrant.exe
   Copy-Item .\config.yaml D:\Qdrant\config\config.yaml
   ```

## 2. Set the API key (environment variables, never in a file)

Generate one random key and set it machine-wide. Qdrant reads `QDRANT__SERVICE__API_KEY`; the API and
the worker send the same value as `Assistant__Qdrant__ApiKey`.

```powershell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$key = -join ($b | ForEach-Object { $_.ToString('x2') })
[Environment]::SetEnvironmentVariable('QDRANT__SERVICE__API_KEY', $key, 'Machine')
[Environment]::SetEnvironmentVariable('Assistant__Qdrant__ApiKey', $key, 'Machine')
```

Open a new PowerShell window afterwards (the current one doesn't see the new variables). Recycle the API's
IIS app pool (or run `iisreset`) so the API picks up `Assistant__Qdrant__ApiKey`.

## 3. Run Qdrant as a service (WinSW)

1. Download `WinSW-x64.exe` (v2.12.0) from <https://github.com/winsw/winsw/releases>.
2. Copy it to `D:\Qdrant\qdrant-service.exe`, and `qdrant-service.xml` next to it. WinSW pairs the
   `.exe` and the `.xml` by name.
3. Install and start:
   ```powershell
   cd D:\Qdrant
   .\qdrant-service.exe install
   .\qdrant-service.exe start
   ```
4. Check it is up and that the key works:
   ```powershell
   Invoke-RestMethod http://127.0.0.1:6333/healthz
   Invoke-RestMethod http://127.0.0.1:6333/ -Headers @{ 'api-key' = $env:QDRANT__SERVICE__API_KEY }   # shows version 1.20.0
   ```
   Logs are in `D:\Qdrant\logs`. Stop or uninstall with `qdrant-service.exe stop` / `uninstall`.

## 4. Firewall: do not expose Qdrant

- Do **not** open ports 6333 or 6334, and don't proxy them through IIS/Plesk. Qdrant listens on
  127.0.0.1 only (`service.host` in `config.yaml`), and only the API and the worker on this machine use it.
- To be safe, add a block rule as well:
  ```powershell
  New-NetFirewallRule -DisplayName "Qdrant - block inbound" -Direction Inbound -Protocol TCP -LocalPort 6333,6334 -Action Block
  ```

## 5. Nightly snapshots

The index can always be rebuilt from MySQL with `--full`, but that re-embeds everything (Gemini cost and
time). A nightly snapshot avoids that. Save this as `D:\Qdrant\snapshot.ps1`. It keeps the last 7
snapshots per collection in `D:\Qdrant\snapshots`:

```powershell
$ErrorActionPreference = 'Stop'
$h = @{ 'api-key' = [Environment]::GetEnvironmentVariable('QDRANT__SERVICE__API_KEY', 'Machine') }
foreach ($c in 'rotary_projects', 'rotary_comms') {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:6333/collections/$c/snapshots?wait=true" -Headers $h | Out-Null
    $snaps = (Invoke-RestMethod -Uri "http://127.0.0.1:6333/collections/$c/snapshots" -Headers $h).result |
             Sort-Object creation_time -Descending
    $snaps | Select-Object -Skip 7 | ForEach-Object {
        Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:6333/collections/$c/snapshots/$($_.name)" -Headers $h | Out-Null
    }
}
```

Schedule it to run after the worker (the worker runs at 03:45):

```powershell
schtasks /Create /TN "\ROW\Qdrant Snapshot Nightly" /SC DAILY /ST 04:30 /RU SYSTEM `
  /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\Qdrant\snapshot.ps1"
```

Include `D:\Qdrant\snapshots` in the normal server backup. To restore a collection, use
`PUT /collections/{name}/snapshots/recover` with `{"location": "file:///D:/Qdrant/snapshots/<name>/<file>.snapshot"}`,
or run the worker with `--full`.

## 6. Run the worker

**Prerequisites:**

- The assistant tables exist on production. Run `SQL/assistant_tables.sql` by hand; the worker only
  uses `assistant_index_items` and the purge tables, and creates no tables.
- The .NET 10 runtime is installed (the other workers need it too).
- The MySQL user can SELECT the source tables and `information_schema`, and can write the
  `assistant_*` tables. The worker writes nothing else.

**Publish and deploy:**

```powershell
cd AssistantIndexWorker
dotnet publish -c Release -r win-x64 --self-contained false -o publish-worker
# copy publish-worker\* to <server folder>\AssistantIndexWorker\
```

**Configuration.** `appsettings.json` ships with every secret empty. Set these machine-level
environment variables. The scheduled task runs as SYSTEM, so it reads machine-level variables.

| Variable | Value |
|---|---|
| `Assistant__Gemini__ApiKey` | The billing-enabled Gemini key the API uses for the assistant. Do not use the free-tier key. |
| `Assistant__Qdrant__ApiKey` | Same value as `QDRANT__SERVICE__API_KEY` (set in step 2). |
| `ConnectionStrings__DefaultConnection` | The production MySQL connection string. |

`ConnectionStrings__DefaultConnection` overrides `appsettings.json` for **every** ASP.NET Core app on the
box, the API included. Set it machine-wide only if it is identical to the API's connection string.
Otherwise, put the value into the **deployed** copy of `appsettings.json` on the server, and never
commit it.

`EmbeddingModel` (`gemini-embedding-2`) and `EmbeddingDims` (768) must match the API's `Assistant:Gemini`
settings. The document text is formatted `title: … | text: …`, and the API's query embeddings depend on
that format.

**First run, done once by hand:**

```powershell
cd <server folder>\AssistantIndexWorker
.\AssistantIndexWorker.exe --full --dry-run   # counts only; no Gemini or Qdrant calls
.\AssistantIndexWorker.exe --full             # creates both collections and embeds everything
```

**Then schedule the nightly run** (`--delta --cleanup` at 03:45):

```powershell
schtasks /Create /XML TaskScheduler-AssistantIndex-Nightly.xml /TN "\ROW\Assistant Index Nightly"
```

**Modes:**

| Option | What it does |
|---|---|
| `--full` | Re-embeds every live row. Also deletes points that no row backs any more. |
| `--delta` | Embeds only new or changed rows (compared by content hash in `assistant_index_items`), and deletes points whose rows are gone. If a collection is missing, it is recreated and fully re-embedded. |
| `--cleanup` | Purges messages, security events and conversations older than 90 days, expired answer-cache rows, and usage rows older than 400 days. |
| `--dry-run` | Counts only. Use it with the options above; on its own it previews `--delta`. |

Exit codes: `0` ok, `1` usage/config error, `2` runtime failure. Progress is saved per batch of 100,
so after a failure the next run carries on where this one stopped.

If you change the embedding model, the next `--delta` re-embeds everything, because the model is part
of the content hash. If you change `EmbeddingDims`, first delete both collections
(`DELETE http://127.0.0.1:6333/collections/{name}` with the api-key header), then run `--full`.
