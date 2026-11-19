# Sets up the ROW background workers ON THE SERVER: writes each worker's secrets file from the API's web.config and
# registers the Windows scheduled tasks. Run in an elevated PowerShell from the uploaded workers folder.
#
#   Preview first (writes nothing):
#     .\setup-workers.ps1 -ApiWebConfig 'D:\...\test.rosteronwheels.com\api\web.config' -WhatIf
#   Greetings (hourly) + Awards (nightly):
#     .\setup-workers.ps1 -ApiWebConfig 'D:\...\api\web.config'
#   Also the Rotary.org sync (choose the modes; see README.md for what each one changes):
#     .\setup-workers.ps1 -ApiWebConfig '...' -RotarySync -SyncModes '--delta','--member-sync'
#
# Secrets are copied from the API's <environmentVariables> (one source of truth) into appsettings.secrets.json next to
# each worker; that file is never part of an upload, and only SYSTEM and Administrators can read it.
param(
    [Parameter(Mandatory)] [string]$ApiWebConfig,
    [string]$WorkersRoot = $PSScriptRoot,
    [switch]$RotarySync,
    [string[]]$SyncModes = @('--delta', '--member-sync'),
    [switch]$RccWorker,
    [switch]$WhatIf,
    [switch]$SecretsOnly,   # refresh the secrets files only (after the API's settings change); tasks untouched
    [string]$TaskFolder = '\ROW\'
)
$ErrorActionPreference = 'Stop'

# Rotary.org sync modes that may run unattended, with their start time (server local time). Modes that soft-delete
# clubs or members ("--apply" variants) are deliberately not here: run those by hand after reviewing the audit output.
$SyncSchedule = [ordered]@{
    '--delta'              = '01:30'
    '--repair-sync'        = '02:00'
    '--club-reconcile'     = '02:15'
    '--member-sync'        = '02:45'
    '--member-daily-delta' = '03:00'
    '--bod-sync'           = '03:30'
    '--country-sync'       = '04:30'
}

function Read-ApiEnvironment([string]$path) {
    if (-not (Test-Path $path)) { throw "API web.config not found: $path" }
    [xml]$xml = Get-Content -Raw -Path $path
    $vars = @{}
    foreach ($v in $xml.SelectNodes('//aspNetCore/environmentVariables/environmentVariable')) { $vars[$v.name] = $v.value }
    if ($vars.Count -lt 5) { throw "Only $($vars.Count) environment variables in $path. Is this the full server web.config?" }
    return $vars
}

function Get-SettingKeys($node, [string]$prefix) {
    # Leaf keys of a worker's appsettings.json as A__B (environment-variable spelling).
    foreach ($p in $node.PSObject.Properties) {
        if ($p.Name.StartsWith('_')) { continue }
        $name = if ($prefix) { "${prefix}__$($p.Name)" } else { $p.Name }
        if ($p.Value -is [System.Management.Automation.PSCustomObject]) { Get-SettingKeys $p.Value $name } else { $name }
    }
}

# IDictionary, not [hashtable]: a [hashtable] parameter would turn the ordered tree into a copy and drop every write.
function Set-Nested([System.Collections.IDictionary]$target, [string[]]$path, [string]$value) {
    $node = $target
    for ($i = 0; $i -lt $path.Length - 1; $i++) {
        if (-not $node.Contains($path[$i])) { $node[$path[$i]] = [ordered]@{} }
        $node = $node[$path[$i]]
    }
    $node[$path[-1]] = $value
}

function Write-WorkerSecrets([string]$folder, [hashtable]$apiEnv, [string[]]$required) {
    $settingsFile = Join-Path $folder 'appsettings.json'
    if (-not (Test-Path $settingsFile)) { throw "Missing $settingsFile" }
    $declared = @(Get-SettingKeys (Get-Content -Raw $settingsFile | ConvertFrom-Json) '')
    # Values the worker declares, plus whole sections it reads through Brand.Init and the Rotary.org clients.
    $wanted = $apiEnv.Keys | Where-Object {
        $declared -contains $_ -or $_ -match '^(ConnectionStrings|Brand|Brevo|RotaryOrgApi|RotaryOrgApiLive|Rcc)__'
    }
    $tree = [ordered]@{}
    foreach ($k in ($wanted | Sort-Object)) { Set-Nested $tree ($k -split '__') $apiEnv[$k] }
    $missing = $required | Where-Object { -not $apiEnv.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($apiEnv[$_]) }
    $target = Join-Path $folder 'appsettings.secrets.json'
    Write-Host ("  {0}: {1} settings from the API{2}" -f (Split-Path $folder -Leaf), @($wanted).Count,
        $(if ($missing) { "; MISSING: $($missing -join ', ')" } else { '' }))
    if ($WhatIf) { return }
    ($tree | ConvertTo-Json -Depth 10) | Set-Content -Path $target -Encoding UTF8
    # Only SYSTEM (the tasks' account) and Administrators may read the secrets.
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($id in 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators') {
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'Allow')))
    }
    Set-Acl -Path $target -AclObject $acl
}

function Register-WorkerTask([string]$name, [string]$exe, [string]$arguments, $trigger, [TimeSpan]$limit) {
    Write-Host ("  task {0}{1}: {2} {3}" -f $TaskFolder, $name, (Split-Path $exe -Leaf), $arguments)
    if ($WhatIf) { return }
    if (-not (Test-Path $exe)) { throw "Missing $exe" }
    $action = New-ScheduledTaskAction -Execute $exe -Argument $arguments -WorkingDirectory (Split-Path $exe)
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit $limit
    Register-ScheduledTask -TaskPath $TaskFolder -TaskName $name -Action $action -Trigger $trigger -Principal $principal `
        -Settings $settings -Force | Out-Null
}

$apiEnv = Read-ApiEnvironment $ApiWebConfig
Write-Host "Read $($apiEnv.Count) settings from $ApiWebConfig$(if ($WhatIf) { ' (preview: nothing is written)' })"

Write-Host 'Secrets files:'
Write-WorkerSecrets (Join-Path $WorkersRoot 'GreetingsWorker') $apiEnv @('ConnectionStrings__DefaultConnection', 'Brevo__ApiKey')
Write-WorkerSecrets (Join-Path $WorkersRoot 'AwardsAutoCalcWorker') $apiEnv @('ConnectionStrings__DefaultConnection', 'Brevo__ApiKey')
if ($RotarySync) {
    Write-WorkerSecrets (Join-Path $WorkersRoot 'RotaryOrgSyncWorker') $apiEnv @('ConnectionStrings__DefaultConnection', 'RotaryOrgApi__Username', 'RotaryOrgApi__Password')
}
if ($RccWorker) {
    Write-WorkerSecrets (Join-Path $WorkersRoot 'RccGoalsFetcher') $apiEnv @('ConnectionStrings__DefaultConnection', 'RotaryOrgSync__CredentialKey')
}

if ($SecretsOnly) { Write-Host 'Secrets refreshed; scheduled tasks left as they are.'; return }

Write-Host 'Scheduled tasks:'
# Greetings: hourly, each club/district greets at Greetings:SendHour in its own time zone, once per local day.
$hourly = New-ScheduledTaskTrigger -Daily -At '00:05'
$hourly.Repetition = (New-ScheduledTaskTrigger -Once -At '00:05' -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
Register-WorkerTask 'Greetings Hourly' (Join-Path $WorkersRoot 'GreetingsWorker\GreetingsWorker.exe') '--send' $hourly (New-TimeSpan -Minutes 50)
Register-WorkerTask 'District Citation Nightly' (Join-Path $WorkersRoot 'AwardsAutoCalcWorker\AwardsAutoCalcWorker.exe') '--district-citation' `
    (New-ScheduledTaskTrigger -Daily -At '02:30') (New-TimeSpan -Hours 2)

if ($RotarySync) {
    foreach ($mode in $SyncModes) {
        if (-not $SyncSchedule.Contains($mode)) { throw "Sync mode $mode cannot be scheduled. Allowed: $($SyncSchedule.Keys -join ', ')" }
        Register-WorkerTask ("Rotary.org Sync $($mode.TrimStart('-'))") (Join-Path $WorkersRoot 'RotaryOrgSyncWorker\RotaryOrgSyncWorker.exe') $mode `
            (New-ScheduledTaskTrigger -Daily -At $SyncSchedule[$mode]) (New-TimeSpan -Hours 3)
    }
}
if ($RccWorker) {
    # Long-running poller for District Governors' "Sync" requests (see RccGoalsFetcher\WORKER_SETUP.md).
    Register-WorkerTask 'RCC Goals Worker' (Join-Path $WorkersRoot 'RccGoalsFetcher\RccGoalsFetcher.exe') '--worker' `
        (New-ScheduledTaskTrigger -AtStartup) ([TimeSpan]::Zero)
}

Write-Host $(if ($WhatIf) { 'Preview only. Run again without -WhatIf to apply.' } else { "Done. Check: Get-ScheduledTask -TaskPath '$TaskFolder'" })
