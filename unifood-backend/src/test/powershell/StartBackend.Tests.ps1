#requires -Version 5.1
# Standalone Windows PowerShell tests. No Pester, Maven, network or real .env.
$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$launcherSource = Join-Path $repositoryRoot 'start-backend.ps1'
$temporaryParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$testDirectory = Join-Path $temporaryParent ('unifood-backend-start-' + [guid]::NewGuid().ToString('N'))
$utf8 = [System.Text.UTF8Encoding]::new($false)
$passed = 0
$names = @(
    'SUPABASE_DB_URL', 'SUPABASE_AUTH_ISSUER', 'SPRING_DATASOURCE_USERNAME',
    'SPRING_DATASOURCE_PASSWORD', 'SPRING_PROFILES_ACTIVE', 'SUPABASE_STORAGE_URL',
    'SUPABASE_STORAGE_SECRET_KEY', 'SUPABASE_PRODUCT_IMAGES_BUCKET',
    'PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS', 'PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS',
    'PRODUCT_IMAGES_CLEANUP_ENABLED'
)
$fixture = @'
# Synthetic fixtures. Never sent to any service.
SUPABASE_DB_URL=jdbc:postgresql://127.0.0.1:1/fixture?sslmode=require&connectTimeout=5&label=first=second?third
SUPABASE_AUTH_ISSUER=https://auth.example.invalid/auth/v1
SPRING_DATASOURCE_USERNAME=fixture_user
SPRING_DATASOURCE_PASSWORD='fixture-password=a&b?c#d\literal'
SUPABASE_STORAGE_URL=https://storage.example.invalid/storage/v1
SUPABASE_STORAGE_SECRET_KEY="fixture-storage-secret=a&b?c#d"
SUPABASE_PRODUCT_IMAGES_BUCKET=product-images
PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS=5
PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS=20
PRODUCT_IMAGES_CLEANUP_ENABLED=false
'@

function Assert-Case([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "Assertion failed: $Message" }
}
function Test-Case([string] $Name, [scriptblock] $Body) {
    & $Body
    $script:passed++
    Write-Host "PASS $Name"
}

function Invoke-Fixture {
    param(
        [string] $Content = $fixture,
        [hashtable] $Variables = @{},
        [int] $ExitCode = 0,
        [switch] $NoFile,
        [switch] $NoBackend,
        [switch] $NoWrapper,
        [switch] $EchoSecrets
    )
    $root = Join-Path $testDirectory ('case with spaces ' + [guid]::NewGuid().ToString('N'))
    $backend = Join-Path $root 'unifood-backend'
    $working = Join-Path $root 'different working directory'
    [System.IO.Directory]::CreateDirectory($root) | Out-Null
    [System.IO.Directory]::CreateDirectory($working) | Out-Null
    [System.IO.File]::Copy($launcherSource, (Join-Path $root 'start-backend.ps1'))
    $dotenvPath = Join-Path $backend '.env'
    if (-not $NoBackend) {
        [System.IO.Directory]::CreateDirectory($backend) | Out-Null
        if (-not $NoFile) { [System.IO.File]::WriteAllText($dotenvPath, $Content, $utf8) }
        # A root dotenv must not be read in place of the backend file.
        [System.IO.File]::WriteAllText((Join-Path $root '.env'), 'SUPABASE_DB_URL=wrong-root-file', $utf8)
        if (-not $NoWrapper) {
            [System.IO.File]::WriteAllText((Join-Path $backend 'mvnw.cmd'), @'
@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0probe.ps1" %*
exit /b %errorlevel%
'@, $utf8)
            [System.IO.File]::WriteAllText((Join-Path $backend 'probe.ps1'), @'
$values = @{}
foreach ($name in @('SUPABASE_DB_URL','SUPABASE_AUTH_ISSUER','SPRING_DATASOURCE_USERNAME','SPRING_DATASOURCE_PASSWORD','SPRING_PROFILES_ACTIVE','SUPABASE_STORAGE_URL','SUPABASE_STORAGE_SECRET_KEY','SUPABASE_PRODUCT_IMAGES_BUCKET','PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS','PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS','PRODUCT_IMAGES_CLEANUP_ENABLED')) {
    $values[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
}
$probe = @{ Values = $values; Directory = (Get-Location).Path; Arguments = @($args); PowerShell = $PSVersionTable.PSVersion.ToString() }
[System.IO.File]::WriteAllText($env:UNIFOOD_LAUNCHER_PROBE, ($probe | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
if ($env:UNIFOOD_LAUNCHER_ECHO -eq 'true') {
    Write-Output $values.SUPABASE_DB_URL
    Write-Output $values.SPRING_DATASOURCE_PASSWORD
    [Console]::Error.WriteLine($values.SUPABASE_STORAGE_SECRET_KEY)
    Write-Output 'fake-maven-finished'
}
exit ([int] $env:UNIFOOD_LAUNCHER_EXIT)
'@, $utf8)
        }
    }
    [System.IO.File]::WriteAllText((Join-Path $root 'invoke.ps1'), @'
$names = @('SUPABASE_DB_URL','SUPABASE_AUTH_ISSUER','SPRING_DATASOURCE_USERNAME','SPRING_DATASOURCE_PASSWORD','SPRING_PROFILES_ACTIVE','SUPABASE_STORAGE_URL','SUPABASE_STORAGE_SECRET_KEY','SUPABASE_PRODUCT_IMAGES_BUCKET','PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS','PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS','PRODUCT_IMAGES_CLEANUP_ENABLED')
$before = @{}
foreach ($name in $names) { $before[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process') }
$directory = (Get-Location).Path
& (Join-Path $PSScriptRoot 'start-backend.ps1')
$result = $LASTEXITCODE
$restored = $true
foreach ($name in $names) {
    if ($before[$name] -cne [System.Environment]::GetEnvironmentVariable($name, 'Process')) { $restored = $false }
}
$state = @{ EnvironmentRestored = $restored; DirectoryRestored = ($directory -eq (Get-Location).Path) }
[System.IO.File]::WriteAllText($env:UNIFOOD_LAUNCHER_STATE, ($state | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
exit $result
'@, $utf8)

    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $info.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $root 'invoke.ps1') + '"'
    $info.WorkingDirectory = $working
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($name in $names) { $info.EnvironmentVariables.Remove($name) }
    foreach ($name in $Variables.Keys) { $info.EnvironmentVariables[$name] = $Variables[$name] }
    $info.EnvironmentVariables['UNIFOOD_LAUNCHER_PROBE'] = Join-Path $root 'probe.json'
    $info.EnvironmentVariables['UNIFOOD_LAUNCHER_STATE'] = Join-Path $root 'state.json'
    $info.EnvironmentVariables['UNIFOOD_LAUNCHER_EXIT'] = $ExitCode.ToString()
    $info.EnvironmentVariables['UNIFOOD_LAUNCHER_ECHO'] = $EchoSecrets.ToString().ToLowerInvariant()
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        [void] $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Fixture process timed out' }
        $probe = $null
        if (Test-Path -LiteralPath (Join-Path $root 'probe.json')) {
            $probe = [System.IO.File]::ReadAllText((Join-Path $root 'probe.json')) | ConvertFrom-Json
        }
        $state = [System.IO.File]::ReadAllText((Join-Path $root 'state.json')) | ConvertFrom-Json
        Assert-Case $state.EnvironmentRestored 'temporary environment changes must be restored'
        Assert-Case $state.DirectoryRestored 'working directory must be restored'
        if (-not $NoBackend -and -not $NoFile) {
            Assert-Case ([System.IO.File]::ReadAllText($dotenvPath) -ceq $Content) 'dotenv must never be rewritten'
        }
        return @{ Exit = $process.ExitCode; Output = ($stdout.Result + $stderr.Result); Probe = $probe; Root = $root }
    }
    finally { $process.Dispose() }
}

try {
    [System.IO.Directory]::CreateDirectory($testDirectory) | Out-Null
    Test-Case 'PowerShell 5.1 parses launcher without syntax errors' {
        $tokens = $null; $errors = $null
        [void] [System.Management.Automation.Language.Parser]::ParseFile($launcherSource, [ref] $tokens, [ref] $errors)
        Assert-Case ($errors.Count -eq 0) 'launcher syntax'
    }
    Test-Case 'loads exact literal values, correct backend and Maven goal' {
        $result = Invoke-Fixture
        Assert-Case ($result.Exit -eq 0) 'successful launch'
        Assert-Case ($result.Probe.Values.SPRING_DATASOURCE_PASSWORD -ceq 'fixture-password=a&b?c#d\literal') 'password characters'
        Assert-Case ($result.Probe.Values.SUPABASE_STORAGE_SECRET_KEY -ceq 'fixture-storage-secret=a&b?c#d') 'secret characters'
        Assert-Case ($result.Probe.Values.SUPABASE_DB_URL.EndsWith('label=first=second?third')) 'split at first equals only'
        Assert-Case ($result.Probe.Values.PRODUCT_IMAGES_CLEANUP_ENABLED -ceq 'false') 'cleanup choice'
        Assert-Case ($result.Probe.Directory -eq (Join-Path $result.Root 'unifood-backend')) 'backend located independently of cwd'
        Assert-Case ($result.Probe.Arguments.Count -eq 1 -and $result.Probe.Arguments[0] -ceq 'spring-boot:run') 'Maven goal'
        Assert-Case ($result.Probe.PowerShell.StartsWith('5.1.')) 'real Windows PowerShell compatibility'
    }
    Test-Case 'process variables override dotenv and are restored' {
        $result = Invoke-Fixture -Variables @{ SUPABASE_STORAGE_SECRET_KEY = 'existing-process-secret'; PRODUCT_IMAGES_CLEANUP_ENABLED = 'true' }
        Assert-Case ($result.Probe.Values.SUPABASE_STORAGE_SECRET_KEY -ceq 'existing-process-secret') 'process precedence'
        Assert-Case ($result.Probe.Values.PRODUCT_IMAGES_CLEANUP_ENABLED -ceq 'true') 'process cleanup precedence'
    }
    Test-Case 'UTF8 BOM, export, quoted spaces and Unicode survive' {
        $unicode = 'contrase' + [char] 0x00F1 + 'a=' + [char] 0x00E9 + '&?'
        $content = [char] 0xFEFF + $fixture.Replace("SPRING_DATASOURCE_PASSWORD='fixture-password=a&b?c#d\literal'", "export SPRING_DATASOURCE_PASSWORD='  $unicode  '")
        $result = Invoke-Fixture -Content $content
        Assert-Case ($result.Exit -eq 0) 'BOM/export launch'
        Assert-Case ($result.Probe.Values.SPRING_DATASOURCE_PASSWORD -ceq "  $unicode  ") 'quoted literal Unicode'
    }
    Test-Case 'no dotenv is needed when required process environment is supplied' {
        $result = Invoke-Fixture -NoFile -Variables @{ SUPABASE_DB_URL = 'jdbc:postgresql://127.0.0.1:1/test'; SUPABASE_AUTH_ISSUER = 'http://127.0.0.1:1/auth/v1' }
        Assert-Case ($result.Exit -eq 0 -and $result.Output.Contains('No existe unifood-backend/.env')) 'process-only startup'
    }
    Test-Case 'missing dotenv and required variables fail before Maven' {
        $result = Invoke-Fixture -NoFile
        Assert-Case ($result.Exit -eq 1 -and $null -eq $result.Probe) 'no Maven invocation'
        Assert-Case ($result.Output.Contains('SUPABASE_DB_URL') -and $result.Output.Contains('SUPABASE_AUTH_ISSUER')) 'actionable missing names'
    }
    Test-Case 'missing backend or Maven wrapper gives safe errors' {
        foreach ($option in @('NoBackend', 'NoWrapper')) {
            $parameters = @{ $option = $true }
            $result = Invoke-Fixture @parameters
            Assert-Case ($result.Exit -eq 1 -and $null -eq $result.Probe) 'missing startup files'
        }
    }
    Test-Case 'required variables reject empty and whitespace values' {
        foreach ($name in @('SUPABASE_DB_URL', 'SUPABASE_AUTH_ISSUER')) {
            $content = [regex]::Replace($fixture, '(?m)^' + $name + '=.*$', $name + "='   '")
            $result = Invoke-Fixture -Content $content
            Assert-Case ($result.Exit -eq 1 -and $result.Output.Contains($name) -and $null -eq $result.Probe) 'required validation'
        }
    }
    Test-Case 'Storage requires both URL and credential without printing their values' {
        foreach ($name in @('SUPABASE_STORAGE_URL', 'SUPABASE_STORAGE_SECRET_KEY')) {
            $content = [regex]::Replace($fixture, '(?m)^' + $name + '=.*$', $name + '=')
            $result = Invoke-Fixture -Content $content
            Assert-Case ($result.Exit -eq 1 -and $result.Output.Contains($name) -and $null -eq $result.Probe) 'paired Storage configuration'
            Assert-Case (-not $result.Output.Contains('fixture-storage-secret')) 'secret not disclosed on validation failure'
        }
    }
    Test-Case 'both Storage settings can remain absent for commercial-only startup' {
        $content = [regex]::Replace($fixture, '(?m)^SUPABASE_STORAGE_(URL|SECRET_KEY)=.*$', '')
        $result = Invoke-Fixture -Content $content
        Assert-Case ($result.Exit -eq 0) 'optional Storage preserved'
    }
    Test-Case 'malformed lines, quotes and duplicates never disclose input' {
        foreach ($suffix in @('private-canary-invalid-line', 'SUPABASE_STORAGE_SECRET_KEY="private-canary', 'SUPABASE_DB_URL=private-canary')) {
            $result = Invoke-Fixture -Content ($fixture + "`n" + $suffix)
            Assert-Case ($result.Exit -eq 1 -and $null -eq $result.Probe) 'malformed file rejected'
            Assert-Case (-not $result.Output.Contains('private-canary')) 'raw malformed content hidden'
        }
        $brokenQuote = [regex]::Replace($fixture, '(?m)^SUPABASE_STORAGE_SECRET_KEY=.*$', 'SUPABASE_STORAGE_SECRET_KEY="private-canary')
        $result = Invoke-Fixture -Content $brokenQuote
        Assert-Case ($result.Exit -eq 1 -and $result.Output.Contains('Comillas sin cerrar') -and -not $result.Output.Contains('private-canary')) 'unterminated quote'
    }
    Test-Case 'dotenv values are data, never executable PowerShell' {
        $literal = '$(Set-Content -LiteralPath injection-marker -Value executed)'
        $content = [regex]::Replace($fixture, '(?m)^SUPABASE_STORAGE_SECRET_KEY=.*$', ('SUPABASE_STORAGE_SECRET_KEY=' + "'" + $literal.Replace('$','$$') + "'"))
        $result = Invoke-Fixture -Content $content
        Assert-Case ($result.Exit -eq 0 -and $result.Probe.Values.SUPABASE_STORAGE_SECRET_KEY -ceq $literal) 'literal dollar expression'
        Assert-Case (-not (Test-Path -LiteralPath (Join-Path $result.Root 'unifood-backend/injection-marker'))) 'no code execution'
    }
    Test-Case 'dotenv cannot inject execution or Maven settings' {
        foreach ($name in @('PATH', 'MAVEN_OPTS', 'JAVA_TOOL_OPTIONS')) {
            $result = Invoke-Fixture -Content ($fixture + "`n" + $name + '=private-canary')
            Assert-Case ($result.Exit -eq 1 -and $null -eq $result.Probe -and -not $result.Output.Contains('private-canary')) 'execution variables rejected'
        }
    }
    Test-Case 'invalid formats and limits fail with variable names only' {
        foreach ($entry in @(
            @{ Name = 'SUPABASE_DB_URL'; Value = 'private-canary' },
            @{ Name = 'SUPABASE_AUTH_ISSUER'; Value = 'https://user:private-canary@example.invalid/auth/v1' },
            @{ Name = 'SUPABASE_STORAGE_URL'; Value = 'https://example.invalid/private-canary' },
            @{ Name = 'SUPABASE_PRODUCT_IMAGES_BUCKET'; Value = 'private-canary/not-a-bucket' },
            @{ Name = 'PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS'; Value = '11' },
            @{ Name = 'PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS'; Value = '0' },
            @{ Name = 'PRODUCT_IMAGES_CLEANUP_ENABLED'; Value = 'private-canary' }
        )) {
            $content = [regex]::Replace($fixture, '(?m)^' + $entry.Name + '=.*$', $entry.Name + '=' + $entry.Value)
            $result = Invoke-Fixture -Content $content
            Assert-Case ($result.Exit -eq 1 -and $null -eq $result.Probe -and $result.Output.Contains($entry.Name)) 'invalid configuration rejected'
            Assert-Case (-not $result.Output.Contains('private-canary')) 'invalid value not logged'
        }
    }
    Test-Case 'Maven stdout/stderr are redacted and its exact exit code is preserved' {
        foreach ($code in @(0, 7, 23)) {
            $result = Invoke-Fixture -ExitCode $code -EchoSecrets
            Assert-Case ($result.Exit -eq $code) 'native exit code'
            Assert-Case ($result.Output.Contains('fake-maven-finished') -and $result.Output.Contains('[REDACTED]')) 'child output streamed safely'
            foreach ($sensitive in @('fixture-password', 'fixture-storage-secret', 'jdbc:postgresql:')) {
                Assert-Case (-not $result.Output.Contains($sensitive)) 'configured secrets redacted from both streams'
            }
        }
    }
    Test-Case 'private dotenv files are ignored and absent from the Git index' {
        $privatePaths = @('.env', '.env.local', 'unifood-backend/.env', 'unifood-backend/.env.local', 'unifood-web/.env.local')
        $ignored = @(& git -C $repositoryRoot check-ignore -- $privatePaths)
        Assert-Case ($LASTEXITCODE -eq 0 -and $ignored.Count -eq $privatePaths.Count) 'private files ignored'
        $tracked = @(& git -C $repositoryRoot ls-files -- $privatePaths)
        Assert-Case ($LASTEXITCODE -eq 0 -and $tracked.Count -eq 0) 'no tracked private dotenv'
    }
    Write-Host "PASS $passed tests; synthetic fixtures only; no remote connections."
}
finally {
    # Only delete the explicitly owned, generated directory underneath TEMP.
    $resolved = [System.IO.Path]::GetFullPath($testDirectory)
    if (-not $resolved.StartsWith($temporaryParent + '\', [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($resolved) -cnotmatch '^unifood-backend-start-[a-f0-9]{32}$') {
        throw 'Refusing cleanup outside the owned test directory'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
