# Builds the ROW background workers into E:\websites\row\_local\deploy\workers\<Worker>\ for upload to the server.
# Run on the dev PC:  powershell -ExecutionPolicy Bypass -File row\deploy\workers\build-workers.ps1
# The output never contains secrets: appsettings.Local.json and appsettings.secrets.json are removed after publish.
# On the server the secrets live in each worker's appsettings.secrets.json, written by setup-workers.ps1.
param(
    [string]$Out = (Join-Path $PSScriptRoot '..\..\..\_local\deploy\workers'),
    [string[]]$Workers = @('GreetingsWorker', 'AwardsAutoCalcWorker', 'RotaryOrgSyncWorker', 'RccGoalsFetcher')
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..\workers')
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path

foreach ($w in $Workers) {
    $proj = Join-Path $root "$w\$w.csproj"
    if (-not (Test-Path $proj)) { throw "Missing project: $proj" }
    $dest = Join-Path $Out $w
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Write-Host "Publishing $w ..."
    dotnet publish $proj -c Release -r win-x64 --self-contained false -o $dest --nologo -v quiet
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $w" }
    # Never ship a secrets file: an upload would overwrite the server's copy (this broke the API twice).
    Get-ChildItem $dest -Include 'appsettings.Local.json', 'appsettings.secrets.json', 'appsettings.Development.json' -Recurse |
        Remove-Item -Force
}

# Guard: refuse to finish if anything that looks like a secret value slipped into the output.
$leaks = Get-ChildItem $Out -Recurse -Filter '*.json' | Select-String -Pattern '"(Password|ApiKey|DefaultConnection)"\s*:\s*"[^"]+' -List
if ($leaks) { $leaks | ForEach-Object { Write-Warning "Secret-looking value in $($_.Path)" }; throw 'Build output contains secret values. Fix before uploading.' }

Copy-Item (Join-Path $PSScriptRoot 'setup-workers.ps1') $Out -Force
Copy-Item (Join-Path $PSScriptRoot 'README.md') $Out -Force
Write-Host "Done: $Out (upload the whole folder; secrets stay on the server)"
