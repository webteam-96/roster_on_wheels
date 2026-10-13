# Start the ROW API on this machine against a ROW MySQL database.
# Asks for the database password (nothing secret is stored in this file).
#
#   powershell -ExecutionPolicy Bypass -File .\run-local.ps1
#   powershell -ExecutionPolicy Bypass -File .\run-local.ps1 -FirstRun   # creates/updates tables and the SuperAdmin

param(
    [string]$DbHost = "163.128.34.90",
    [int]$Port = 3306,
    [string]$Database = "row_production",
    [string]$User = "Mysql_admin_User",
    [string]$SuperAdminEmail = "mukesh.dhole@kaizeninfotech.com",
    [int]$ApiPort = 5050,   # 5000 is usually taken by a local RIZones API
    [switch]$FirstRun
)

if ($Database -notlike "row*") {
    Write-Host "Refusing to start: database '$Database' is not a ROW database." -ForegroundColor Red
    exit 1
}

$secure = Read-Host "MySQL password for $User@$DbHost" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

$env:ConnectionStrings__DefaultConnection = "Server=$DbHost;Port=$Port;Database=$Database;User=$User;Password=$password"
if (-not $env:JwtSettings__Secret) {
    # A fresh random secret each start: sign-ins last until the API is restarted.
    $env:JwtSettings__Secret = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
}
$env:Brand__SuperAdminEmail = $SuperAdminEmail
$env:Database__SkipInit = if ($FirstRun) { "false" } else { "true" }

Write-Host "Database : $Database on ${DbHost}:$Port as $User"
Write-Host "SkipInit : $($env:Database__SkipInit)"
Write-Host "Starting the API on http://localhost:$ApiPort ..."

Set-Location $PSScriptRoot
dotnet run --urls "http://localhost:$ApiPort"
