# Applies numbered migrations to unifood-staging, stopping at the first failure.
# The password is requested at run time and never stored. Keep this file ASCII:
# Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI.
param(
  [Parameter(Mandatory = $true)][string] $ProjectRef,
  [Parameter(Mandatory = $true)][string] $ConnectionUri,
  [string] $From = '001',
  [string] $Through = '017'
)
# psql writes harmless NOTICE lines to stderr: failures come from $LASTEXITCODE and throw.
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$migrations = Join-Path $root 'unifood-backend\supabase\migrations'
$check = Join-Path $PSScriptRoot 'staging-check.sql'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if ($env:UNIFOOD_PSQL) { $psql = $env:UNIFOOD_PSQL }

if ($ConnectionUri -match '://[^/@:]+:[^/@]+@') {
  throw 'Remove the password from the connection string; it is requested at run time.'
}
if ($ConnectionUri -notlike "*$ProjectRef*") {
  throw "The connection string does not belong to project $ProjectRef."
}

$files = @(Get-ChildItem -LiteralPath $migrations -Filter '*.sql' | Sort-Object Name |
  Where-Object { $_.Name.Substring(0, 3) -ge $From -and $_.Name.Substring(0, 3) -le $Through })
if ($files.Count -eq 0) { throw "No migrations between $From and $Through." }

$hadPassword = [bool] $env:PGPASSWORD
$hadSslMode = [bool] $env:PGSSLMODE
try {
  if (-not $hadPassword) {
    $secure = Read-Host -AsSecureString "Database password for $ProjectRef"
    $env:PGPASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
  }
  if (-not $hadSslMode) { $env:PGSSLMODE = 'require' }
  $env:PGCLIENTENCODING = 'UTF8'

  # Starting from 001 is only valid on an empty project: this protects a real one.
  if ($From -eq '001') {
    $exists = & $psql $ConnectionUri -X -q -t -A -c "SELECT to_regclass('public.users') IS NOT NULL"
    if ($LASTEXITCODE -ne 0) { throw 'Could not connect.' }
    if (([string] $exists).Trim() -ne 'f') { throw 'The database is not empty. Nothing was applied.' }
  }

  foreach ($file in $files) {
    Write-Host "Applying $($file.Name)"
    & $psql $ConnectionUri -X -q -v ON_ERROR_STOP=1 -f $file.FullName
    if ($LASTEXITCODE -ne 0) {
      throw "Failed in $($file.Name). Later migrations were not applied."
    }
  }

  & $psql $ConnectionUri -X -v ON_ERROR_STOP=1 -f $check
  if ($LASTEXITCODE -ne 0) { throw 'The final check failed.' }
} finally {
  if (-not $hadPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  if (-not $hadSslMode) { Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue }
  Remove-Item Env:PGCLIENTENCODING -ErrorAction SilentlyContinue
}
