# Installs LibreTranslate on this Windows server so ROW can translate without an outside service.
# It listens on 127.0.0.1 only, so no IIS site, port or firewall rule is needed: the API on this server calls it directly.
# Needs Python 3.12 (py launcher), about 2.5 GB of disk and 1.5 GB of free memory. Run in an elevated PowerShell:
#
#     powershell -ExecutionPolicy Bypass -File install-libretranslate.ps1
#
# Then add to the API's web.config and recycle its app pool:
#     Translation__Provider = libretranslate
#     Translation__ApiUrl   = http://127.0.0.1:5100
#
# Remove: Unregister-ScheduledTask -TaskName ROW-LibreTranslate -Confirm:$false, then delete the install folder.

param(
    [string]$Dir = "C:\row-translate",
    [int]$Port = 5100,
    [string]$Languages = "en,fr,de,it,ja,ko,pt,es"
)
$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
if (-not (Test-Path "$Dir\venv")) { & py -3.12 -m venv "$Dir\venv" }
& "$Dir\venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
& "$Dir\venv\Scripts\python.exe" -m pip install --quiet "libretranslate==1.9.6"

# PYTHONUTF8: without it LibreTranslate crashes on Windows while downloading models (charmap error).
# XDG_*: keeps the models in this folder, so the service account finds them.
@"
@echo off
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set XDG_DATA_HOME=$Dir\data
set XDG_CONFIG_HOME=$Dir\config
set XDG_CACHE_HOME=$Dir\cache
"$Dir\venv\Scripts\libretranslate.exe" --host 127.0.0.1 --port $Port --load-only $Languages --disable-web-ui >> "$Dir\libretranslate.log" 2>&1
"@ | Set-Content -Encoding ascii "$Dir\run.cmd"

$action = New-ScheduledTaskAction -Execute "$Dir\run.cmd"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Limited
Register-ScheduledTask -TaskName "ROW-LibreTranslate" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "ROW-LibreTranslate"

Write-Host "Started. The first start downloads the language models (about 2 GB), which takes several minutes."
Write-Host "Check: Invoke-RestMethod http://127.0.0.1:$Port/languages"
