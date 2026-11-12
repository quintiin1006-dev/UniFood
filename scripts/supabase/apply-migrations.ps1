# Applies pending migrations of unifood-backend/supabase/migrations, in order, to the
# database in UNIFOOD_MIGRATIONS_DB_URL, and records each one in public.schema_migrations.
#
#   $env:UNIFOOD_MIGRATIONS_DB_URL = 'postgresql://postgres.<ref>@<pooler-host>:5432/postgres'
#   .\scripts\supabase\apply-migrations.ps1 -PlanOnly   # shows the plan, applies nothing
#   .\scripts\supabase\apply-migrations.ps1             # asks to type the project ref
#
# - The URL carries no password: it is requested at run time (or taken from PGPASSWORD).
# - The first run on a database only creates the registry (bootstrap-schema-migrations.sql),
#   recording what is already installed; run the script again to apply what is pending.
# - A migration with its own BEGIN/COMMIT gets its registry row right after BEGIN: both
#   commit or roll back together, and a second operator fails on the duplicate key before
#   any DDL. A file without them is wrapped in one transaction the same way.
# - Files listed in $outsideTransaction (019: ALTER TYPE ... ADD VALUE) never run inside a
#   transaction block; the script refuses them if they gain a BEGIN. Their row is written
#   right after them, so they must stay idempotent (019 uses IF NOT EXISTS).
# - Stops at the first failure. Never edits the migration files.
#
# Keep this file ASCII: Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI.
[CmdletBinding()]
param(
  # Last version to apply, inclusive.
  [ValidatePattern('^[0-9]{3}$')][string] $Through = '999',
  # Show the target and the plan, then exit without applying anything.
  [switch] $PlanOnly,
  # Pending versions below the last applied one that may still run (e.g. 022 later on).
  [string[]] $AllowOutOfOrder = @()
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

# A list like 018,019 arrives as numbers: bring it back to three digits.
$AllowOutOfOrder = @($AllowOutOfOrder | ForEach-Object {
  if ("$_" -notmatch '^[0-9]{1,3}$') { throw "AllowOutOfOrder takes versions like 022, not '$_'." }
  '{0:D3}' -f [int] "$_"
})

$outsideTransaction = @('019')

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$migrationsDir = Join-Path $root 'unifood-backend\supabase\migrations'
$bootstrap = Join-Path $PSScriptRoot 'bootstrap-schema-migrations.sql'
# psql comes from PATH; UNIFOOD_PSQL points to another one.
if ($env:UNIFOOD_PSQL) {
  $psql = $env:UNIFOOD_PSQL
  if (-not (Test-Path -LiteralPath $psql)) { throw "psql not found at UNIFOOD_PSQL ($psql)." }
} else {
  $found = Get-Command psql -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw 'psql is not in PATH. Add PostgreSQL bin to PATH or set UNIFOOD_PSQL.' }
  $psql = $found.Source
}

# --- Target --------------------------------------------------------------------------------
$uri = $env:UNIFOOD_MIGRATIONS_DB_URL
if (-not $uri) { throw 'Set UNIFOOD_MIGRATIONS_DB_URL to the target database (without password).' }
if ($uri -notmatch '^postgres(ql)?://') { throw 'UNIFOOD_MIGRATIONS_DB_URL must be a postgresql:// URL.' }
if ($uri -match '://[^/@:]+:[^/@]+@' -or $uri -match '(?i)[?&]password=') {
  throw 'Remove the password from UNIFOOD_MIGRATIONS_DB_URL; it is requested at run time.'
}
$parsed = [System.Uri] $uri
$dbUser = [System.Uri]::UnescapeDataString($parsed.UserInfo)
$dbHost = $parsed.Host
$dbPort = if ($parsed.Port -gt 0) { $parsed.Port } else { 5432 }
$dbName = $parsed.AbsolutePath.TrimStart('/')
# Supabase project ref: db.<ref>.supabase.co (direct) or user postgres.<ref> (pooler).
if ($dbHost -match '^db\.([a-z0-9]{20})\.supabase\.co$') { $project = $Matches[1] }
elseif ($dbUser -match '^[^.]+\.([a-z0-9]{20})$') { $project = $Matches[1] }
else { $project = $dbHost }

$operator = if ($env:UNIFOOD_MIGRATIONS_OPERATOR) { $env:UNIFOOD_MIGRATIONS_OPERATOR } else { $env:USERNAME }
$operator = ($operator -replace '[^A-Za-z0-9 ._@-]', '').Trim()
if (-not $operator) { throw 'Set UNIFOOD_MIGRATIONS_OPERATOR to the name of who applies the migrations.' }

# --- Local files (checked before connecting) ---------------------------------------------
$files = @()
foreach ($item in Get-ChildItem -LiteralPath $migrationsDir -Filter '*.sql' | Sort-Object Name) {
  if ($item.Name -notmatch '^([0-9]{3})_[a-z0-9_]+\.sql$') { throw "Unexpected migration file name: $($item.Name)" }
  $version = $Matches[1]
  if ($files | Where-Object { $_.Version -eq $version }) { throw "Two migration files use version $version." }

  $content = [System.IO.File]::ReadAllText($item.FullName)
  # Same checksum whatever line endings git used for the checkout.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($content -replace "`r`n", "`n"))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $checksum = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
  $sha.Dispose()

  $begins = [regex]::Matches($content, '(?m)^BEGIN;[ \t]*\r?$')
  $commits = [regex]::Matches($content, '(?m)^COMMIT;[ \t]*\r?$')
  if ($outsideTransaction -contains $version) {
    if ($begins.Count -ne 0 -or $commits.Count -ne 0 -or $content -match '(?im)^\s*(BEGIN|START\s+TRANSACTION)\b\s*;') {
      throw "$($item.Name) must run outside a transaction block, but it now opens one. Nothing was applied."
    }
    $mode = 'outside'
  } elseif ($begins.Count -eq 1 -and $commits.Count -eq 1 -and $begins[0].Index -lt $commits[0].Index) {
    # Only comments may surround the transaction, or they would run outside it.
    $outside = $content.Substring(0, $begins[0].Index) + $content.Substring($commits[0].Index + $commits[0].Length)
    $stray = @($outside -split "`r?`n" | Where-Object { $_ -notmatch '^\s*(--.*)?$' })
    if ($stray.Count -gt 0) { throw "$($item.Name) has statements outside its BEGIN/COMMIT." }
    $mode = 'own'
  } elseif ($begins.Count -eq 0 -and $commits.Count -eq 0) {
    if ($content -match '(?i)\bADD\s+VALUE\b|\bCONCURRENTLY\b|\bVACUUM\b') {
      throw "$($item.Name) cannot run inside a transaction: add its version to `$outsideTransaction after review."
    }
    $mode = 'wrap'
  } else {
    throw "$($item.Name) has an unexpected BEGIN/COMMIT layout."
  }
  $files += [pscustomobject] @{
    Version = $version; Name = $item.Name; Path = $item.FullName
    Content = $content; Checksum = $checksum; Mode = $mode
  }
}
if ($files.Count -eq 0) { throw "No migrations in $migrationsDir." }

# --- Session ------------------------------------------------------------------------------
$hadPassword = [bool] $env:PGPASSWORD
$hadSslMode = [bool] $env:PGSSLMODE
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ('unifood-migrations-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object System.Text.UTF8Encoding($false)

# psql writes harmless NOTICE lines to stderr, so its calls use 'Continue' locally:
# their failures come from $LASTEXITCODE.
function Invoke-Query([string] $Sql) {
  $ErrorActionPreference = 'Continue'
  $out = & $psql $uri -X -q -t -A -F '|' -v ON_ERROR_STOP=1 -c $Sql
  if ($LASTEXITCODE -ne 0) { throw 'Query failed; see the psql error above. Nothing was applied.' }
  return , @($out | Where-Object { $_ -ne '' })
}

# Runs one script file in a session that carries the operator for applied_by.
function Invoke-Script([string] $Label, [string] $Body) {
  $ErrorActionPreference = 'Continue'
  $path = Join-Path $workDir ($Label -replace '[^A-Za-z0-9_.-]', '_')
  $header = "SELECT set_config('unifood.operator', :'unifood_operator', false) AS operator \gset unifood_ignored_`n"
  [System.IO.File]::WriteAllText($path, $header + $Body + "`n", $utf8)
  & $psql $uri -X -q -v ON_ERROR_STOP=1 -v "unifood_operator=$operator" -f $path | Out-Host
  return ($LASTEXITCODE -eq 0)
}

function Show-Registry {
  $ErrorActionPreference = 'Continue'
  & $psql $uri -X -v ON_ERROR_STOP=1 -c 'SELECT version, name, source, applied_at, applied_by, database_role FROM public.schema_migrations ORDER BY version DESC LIMIT 10' | Out-Host
}

try {
  if (-not $hadPassword) {
    $secure = Read-Host -AsSecureString "Database password for $project"
    $env:PGPASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
  }
  if (-not $hadSslMode) { $env:PGSSLMODE = 'require' }
  $env:PGCLIENTENCODING = 'UTF8'
  $env:PGAPPNAME = 'unifood-apply-migrations'
  New-Item -ItemType Directory -Path $workDir | Out-Null

  $info = (Invoke-Query @"
SELECT current_database(), current_user, current_setting('server_version'),
       to_regclass('public.schema_migrations') IS NOT NULL,
       to_regclass('public.users') IS NOT NULL
"@)[0].Split('|')
  $hasRegistry = $info[3] -eq 't'
  $hasSchema = $info[4] -eq 't'

  $registered = @{}
  if ($hasRegistry) {
    $rows = Invoke-Query 'SELECT version, name, COALESCE(checksum, '''') FROM public.schema_migrations ORDER BY version'
    foreach ($row in $rows) {
      $parts = $row.Split('|')
      $registered[$parts[0]] = [pscustomobject] @{ Name = $parts[1]; Checksum = $parts[2] }
    }
    # The registry must describe these files exactly, or the plan cannot be trusted.
    foreach ($version in $registered.Keys) {
      $file = $files | Where-Object { $_.Version -eq $version }
      if (-not $file) { throw "Version $version is registered but has no file here. Update the checkout." }
      if ($file.Name -ne $registered[$version].Name) {
        throw "Version $version is registered as $($registered[$version].Name), not $($file.Name)."
      }
      if ($registered[$version].Checksum -and $registered[$version].Checksum -ne $file.Checksum) {
        throw "$($file.Name) changed after it was applied. Applied migrations are not modified."
      }
    }
  }

  $pending = @()
  $lastApplied = ($registered.Keys | Sort-Object | Select-Object -Last 1)
  if ($hasRegistry) {
    $pending = @($files | Where-Object { -not $registered.ContainsKey($_.Version) -and $_.Version -le $Through })
    $early = @($pending | Where-Object { $lastApplied -and $_.Version -lt $lastApplied -and $AllowOutOfOrder -notcontains $_.Version })
    if ($early.Count -gt 0) {
      throw "Pending below the last applied ($lastApplied): $(($early | ForEach-Object { $_.Name }) -join ', '). Use -AllowOutOfOrder after review."
    }
  }

  Write-Host ''
  Write-Host '=============================================================='
  Write-Host "  PROJECT   : $project"
  Write-Host "  Host      : ${dbHost}:$dbPort"
  Write-Host "  Database  : $($info[0])   role: $($info[1])   server: $($info[2])"
  Write-Host "  Operator  : $operator"
  if ($hasRegistry) {
    Write-Host "  Registry  : $($registered.Count) applied, last $(if ($lastApplied) { $lastApplied } else { 'none' })"
  } else {
    Write-Host '  Registry  : MISSING'
  }
  Write-Host '=============================================================='
  if (-not $hasRegistry) {
    Write-Host 'Plan: create public.schema_migrations (bootstrap-schema-migrations.sql).'
    if ($hasSchema) {
      Write-Host '      It records as baseline the migrations already installed. No migration runs.'
    } else {
      Write-Host '      The database has no UniFood schema: the registry starts empty. No migration runs.'
    }
    Write-Host '      Run the script again afterwards to see and apply what is pending.'
  } elseif ($pending.Count -eq 0) {
    Write-Host "Nothing pending through $Through."
    return
  } else {
    Write-Host "Plan: $($pending.Count) migration(s), in this order:"
    foreach ($file in $pending) {
      $note = switch ($file.Mode) { 'outside' { '  (outside a transaction)' } 'wrap' { '  (wrapped in a transaction)' } default { '' } }
      Write-Host "  $($file.Name)$note"
    }
  }
  if ($PlanOnly) { Write-Host 'PlanOnly: nothing was applied.'; return }

  Write-Host ''
  $answer = Read-Host "Type the project ref '$project' to continue"
  if ($answer -cne $project) { Write-Host 'Cancelled. Nothing was applied.'; exit 1 }

  if (-not $hasRegistry) {
    Write-Host 'Creating the registry'
    if (-not (Invoke-Script 'bootstrap.sql' ([System.IO.File]::ReadAllText($bootstrap)))) {
      throw 'The bootstrap failed and was rolled back. Nothing was recorded.'
    }
    Write-Host 'Registry created. Run the script again to apply pending migrations.'
    return
  }

  foreach ($file in $pending) {
    $row = "INSERT INTO public.schema_migrations (version, name, checksum, source) VALUES ('$($file.Version)', '$($file.Name)', '$($file.Checksum)', 'script');"
    switch ($file.Mode) {
      'own' { $body = ([regex] '(?m)^BEGIN;[ \t]*(?=\r?$)').Replace($file.Content, "BEGIN;`n$row", 1) }
      'wrap' { $body = "BEGIN;`n$row`n$($file.Content)`nCOMMIT;" }
      'outside' { $body = "$($file.Content)`n$row" }
    }
    Write-Host "Applying $($file.Name)"
    if (-not (Invoke-Script $file.Name $body)) {
      if ($file.Mode -eq 'outside') {
        throw "Failed in $($file.Name); it ran without a transaction: check its effect and whether it was registered. Later migrations were not applied."
      }
      throw "Failed in $($file.Name); it was rolled back and not registered. Later migrations were not applied."
    }
  }

  Write-Host 'Done. Last rows of the registry:'
  Show-Registry
} finally {
  if (-not $hadPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  if (-not $hadSslMode) { Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue }
  Remove-Item Env:PGCLIENTENCODING, Env:PGAPPNAME -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $workDir) { Remove-Item -LiteralPath $workDir -Recurse -Force }
}
