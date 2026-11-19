<#
  Nightly backup of the ROW production database (backend checklist 84 / security 44).

  Install once on the server (as Administrator):
    1. Create C:\row-backup\my.cnf (readable by the task's account only):
         [client]
         host=<db host>
         port=<db port>
         user=<a read-only backup user: SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES, PROCESS>
         password=<its password>
    2. Copy this script to C:\row-backup\backup-row-db.ps1
    3. Register the task (02:30 server time every night):
         schtasks /Create /TN "ROW DB backup" /SC DAILY /ST 02:30 /RU SYSTEM `
           /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\row-backup\backup-row-db.ps1"
    4. Run it once by hand and check the .sql.gz and the log, then do a test restore into a scratch database.

  The password stays in my.cnf, never in this script or the repo. -OffsiteDir copies each dump to a second
  disk / network share; a backup on the same server does not survive losing that server.
#>
param(
  [string]$Database   = "row_production",
  [string]$OptionFile = "C:\row-backup\my.cnf",
  [string]$OutDir     = "C:\row-backup\dumps",
  [string]$OffsiteDir = "",
  [int]   $KeepDays   = 14,
  [string]$MysqlDump  = "mysqldump"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$log   = Join-Path $OutDir "backup.log"
$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd_HHmm")
$sql   = Join-Path $OutDir "$Database-$stamp.sql"
function Write-Log($m) { "$((Get-Date).ToUniversalTime().ToString('u'))  $m" | Add-Content $log }

try {
  # --single-transaction: consistent InnoDB snapshot without locking the live site.
  & $MysqlDump "--defaults-extra-file=$OptionFile" --single-transaction --quick --no-tablespaces `
      --routines --triggers --events --set-gtid-purged=OFF --default-character-set=utf8mb4 `
      "--result-file=$sql" $Database
  if ($LASTEXITCODE -ne 0) { throw "mysqldump exit code $LASTEXITCODE" }
  if ((Get-Item $sql).Length -lt 1MB) { throw "dump is under 1 MB, treating as failed" }
  if (-not (Select-String -Path $sql -Pattern "-- Dump completed" -SimpleMatch -Quiet)) { throw "dump has no completion marker" }

  # Compress (gzip, readable anywhere) and drop the raw .sql.
  $gz = "$sql.gz"
  $in = [IO.File]::OpenRead($sql); $out = [IO.File]::Create($gz)
  $z = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
  $in.CopyTo($z); $z.Dispose(); $out.Dispose(); $in.Dispose()
  Remove-Item $sql

  if ($OffsiteDir) { New-Item -ItemType Directory -Force -Path $OffsiteDir | Out-Null; Copy-Item $gz $OffsiteDir }

  Get-ChildItem $OutDir -Filter "$Database-*.sql.gz" |
    Where-Object { $_.LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-$KeepDays) } | Remove-Item
  Write-Log "OK $gz ($([math]::Round((Get-Item $gz).Length / 1MB, 1)) MB)"
}
catch {
  if (Test-Path $sql) { Remove-Item $sql }
  Write-Log "FAILED: $($_.Exception.Message)"
  exit 1
}
