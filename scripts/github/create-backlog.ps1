# Default is a dry run: nothing is written to GitHub without -Apply.
# Encoding: Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI, which corrupts accents
# such as those in issue bodies. This file stays ASCII for that reason: write accents as
# [char]0xF3. To use literal accents, save it as UTF-8 with BOM or run it with pwsh (7+).
param([switch] $Apply)
$ErrorActionPreference = 'Stop'
$repo = 'quintiin1006-dev/UniFood'
$data = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'backlog.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Run([string[]] $cmd) {
  Write-Host ('gh ' + (($cmd | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '))
  if ($Apply) {
    $out = & gh @cmd
    if ($LASTEXITCODE -ne 0) { throw "gh failed: $($cmd -join ' ')" }
    return $out
  }
}

foreach ($l in $data.labels) {
  Run @('label', 'create', $l[0], '--repo', $repo, '--color', $l[1], '--description', $l[2], '--force') | Out-Default
}

$existingMilestones = @()
if ($Apply) { $existingMilestones = @(gh api "repos/$repo/milestones?state=all&per_page=100" --jq '.[].title') }
foreach ($m in $data.milestones) {
  if ($existingMilestones -contains $m[0]) { continue }
  $args2 = @('api', "repos/$repo/milestones", '--method', 'POST', '-f', "title=$($m[0])", '-f', "description=$($m[2])")
  if ($m[1]) { $args2 += @('-f', "due_on=$($m[1])T23:59:59Z") }
  Run $args2 | Out-Default
}

$existing = @{}
if ($Apply) {
  (gh issue list --repo $repo --state all --limit 500 --json number,title | ConvertFrom-Json) | ForEach-Object { $existing[$_.title] = $_.number }
}
$numbers = @{}
$tmp = Join-Path $env:TEMP 'unifood-issue-body.md'
foreach ($i in ($data.issues | Sort-Object @{ Expression = { if ($_.first) { 0 } else { 1 } } }, id)) {
  $title = "[B$($i.id)] $($i.title)"
  if ($existing.ContainsKey($title)) { $numbers[[int]$i.id] = $existing[$title]; continue }
  $labels = @("tipo:$($i.type)", "prioridad:$($i.priority)", "esfuerzo:$($i.size)") + @($i.areas | ForEach-Object { "area:$_" })
  if ($i.cut) { $labels += 'corte:post-demo' }
  $body = "## Criterios de aceptaci$([char]0xF3)n`n`n" + (($i.criteria | ForEach-Object { "- [ ] $_" }) -join "`n") + "`n`n## Dependencias`n`n"
  if ($i.deps.Count) { $body += (($i.deps | ForEach-Object { if ($numbers.ContainsKey([int]$_)) { "- #$($numbers[[int]$_])" } else { "- B$_" } }) -join "`n") } else { $body += 'Ninguna' }
  $body += "`n`nEsfuerzo: $($i.size)."
  [System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding($false)))
  $cmd = @('issue', 'create', '--repo', $repo, '--title', $title, '--milestone', $i.milestone, '--body-file', $tmp)
  foreach ($l in $labels) { $cmd += @('--label', $l) }
  $url = Run $cmd
  if ($Apply) { $numbers[[int]$i.id] = [int](([string]$url).Trim() -replace '.*/', '') }
  if ($i.closed) {
    $n = if ($Apply) { [string]$numbers[[int]$i.id] } else { "<B$($i.id)>" }
    Run @('issue', 'close', $n, '--repo', $repo, '--reason', 'completed') | Out-Default
  }
}
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp }
if ($Apply) { $numbers.GetEnumerator() | Sort-Object Name | ForEach-Object { "B$($_.Name) -> #$($_.Value)" } }
