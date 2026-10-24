#requires -Version 5.1
<#
Local launcher. Reads unifood-backend/.env as DATA, never as PowerShell code.
Non-empty process variables take precedence. Never writes .env or user/machine env.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$backendDirectory = Join-Path $PSScriptRoot 'unifood-backend'
$environmentFile = Join-Path $backendDirectory '.env'
$mavenWrapper = Join-Path $backendDirectory 'mvnw.cmd'
$previousEnvironment = @{}
$locationPushed = $false
$launcherExitCode = 1

function Stop-BackendConfiguration([string] $Message) {
    throw [System.InvalidOperationException]::new("UniFood: $Message")
}

function Assert-BackendUrl([string] $Name, [string] $Value, [switch] $Storage) {
    $uri = $null
    if ($Value -cne $Value.Trim() -or
        -not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref] $uri) -or
        $uri.Scheme -notin @('http', 'https') -or [string]::IsNullOrEmpty($uri.Host) -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        Stop-BackendConfiguration "$Name debe ser una URL HTTP(S) sin credenciales, query ni fragmento."
    }
    if ($Storage) {
        if ($uri.AbsolutePath.TrimEnd('/') -cne '/storage/v1' -or
            ($uri.Scheme -ne 'https' -and $uri.Host -notin @('localhost', '127.0.0.1', '[::1]', '::1'))) {
            Stop-BackendConfiguration "$Name requiere HTTPS y la ruta /storage/v1; HTTP solo en loopback."
        }
    }
}

try {
    if (-not (Test-Path -LiteralPath $backendDirectory -PathType Container)) {
        Stop-BackendConfiguration 'No se encontro unifood-backend junto al script.'
    }
    if (-not (Test-Path -LiteralPath $mavenWrapper -PathType Leaf)) {
        Stop-BackendConfiguration 'No se encontro unifood-backend/mvnw.cmd.'
    }

    # Explicit application inputs only: a dotenv file cannot change PATH, Maven
    # arguments, Java agents, or the PowerShell execution environment.
    $supportedNames = @(
        'SUPABASE_DB_URL', 'SUPABASE_AUTH_ISSUER',
        'SPRING_DATASOURCE_USERNAME', 'SPRING_DATASOURCE_PASSWORD', 'SPRING_PROFILES_ACTIVE',
        'SUPABASE_STORAGE_URL', 'SUPABASE_STORAGE_SECRET_KEY', 'SUPABASE_PRODUCT_IMAGES_BUCKET',
        'PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS', 'PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS',
        'PRODUCT_IMAGES_CLEANUP_ENABLED'
    )
    $fileValues = @{}
    if (Test-Path -LiteralPath $environmentFile -PathType Leaf) {
        $lineNumber = 0
        foreach ($line in [System.IO.File]::ReadAllLines($environmentFile, [System.Text.Encoding]::UTF8)) {
            $lineNumber++
            if ($line -match '^\s*(#.*)?$') { continue }
            if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
                Stop-BackendConfiguration "Formato .env invalido en linea $lineNumber; se espera NOMBRE=valor."
            }
            $name = $Matches[1].ToUpperInvariant()
            $value = $Matches[2].Trim()
            if ($name -notin $supportedNames) {
                Stop-BackendConfiguration "Variable no admitida en .env, linea $lineNumber. Consulta docs/local-development.md."
            }
            if ($fileValues.ContainsKey($name)) {
                Stop-BackendConfiguration "Variable duplicada en .env, linea $lineNumber ($name)."
            }
            if ($value.StartsWith('"') -or $value.StartsWith("'")) {
                if ($value.Length -lt 2 -or $value[$value.Length - 1] -cne $value[0]) {
                    Stop-BackendConfiguration "Comillas sin cerrar en .env, linea $lineNumber."
                }
                $value = $value.Substring(1, $value.Length - 2)
            }
            # No interpolation, unescaping, inline comments or evaluation. The
            # entire value after the FIRST '=' is retained, including &, ?, #, $.
            $fileValues[$name] = $value
        }
    }
    else {
        Write-Host 'No existe unifood-backend/.env; se usaran las variables del proceso.'
    }

    $effective = @{}
    foreach ($name in $supportedNames) {
        $current = [System.Environment]::GetEnvironmentVariable($name, 'Process')
        $effective[$name] = $current
        if ([string]::IsNullOrEmpty($current) -and $fileValues.ContainsKey($name)) {
            $effective[$name] = $fileValues[$name]
        }
    }
    $missing = @('SUPABASE_DB_URL', 'SUPABASE_AUTH_ISSUER') | Where-Object {
        [string]::IsNullOrWhiteSpace($effective[$_])
    }
    if ($missing) {
        Stop-BackendConfiguration ("Faltan variables obligatorias: " + ($missing -join ', ') + '. Crea unifood-backend/.env desde .env.example o define el entorno del proceso.')
    }
    if (-not $effective.SUPABASE_DB_URL.StartsWith('jdbc:postgresql:') -or
        $effective.SUPABASE_DB_URL -cne $effective.SUPABASE_DB_URL.Trim()) {
        Stop-BackendConfiguration 'SUPABASE_DB_URL debe ser una URL JDBC PostgreSQL.'
    }
    Assert-BackendUrl 'SUPABASE_AUTH_ISSUER' $effective.SUPABASE_AUTH_ISSUER

    $storageUrlPresent = -not [string]::IsNullOrEmpty($effective.SUPABASE_STORAGE_URL)
    $storageSecretPresent = -not [string]::IsNullOrEmpty($effective.SUPABASE_STORAGE_SECRET_KEY)
    if ($storageUrlPresent -or $storageSecretPresent) {
        foreach ($name in @('SUPABASE_STORAGE_URL', 'SUPABASE_STORAGE_SECRET_KEY')) {
            if ([string]::IsNullOrWhiteSpace($effective[$name])) {
                Stop-BackendConfiguration "$name es obligatoria cuando Storage esta configurado."
            }
        }
        Assert-BackendUrl 'SUPABASE_STORAGE_URL' $effective.SUPABASE_STORAGE_URL -Storage
    }
    if ($effective.SUPABASE_PRODUCT_IMAGES_BUCKET -and
        $effective.SUPABASE_PRODUCT_IMAGES_BUCKET -cnotmatch '^[a-z0-9][a-z0-9-]{0,62}$') {
        Stop-BackendConfiguration 'SUPABASE_PRODUCT_IMAGES_BUCKET tiene un nombre invalido.'
    }
    foreach ($limit in @(
        @{ Name = 'PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS'; Maximum = 10 },
        @{ Name = 'PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS'; Maximum = 30 }
    )) {
        $value = $effective[$limit.Name]
        if ([string]::IsNullOrEmpty($value)) { continue }
        $number = 0
        if ($value -cnotmatch '^[0-9]+$' -or -not [int]::TryParse($value, [ref] $number) -or
            $number -lt 1 -or $number -gt $limit.Maximum) {
            Stop-BackendConfiguration ($limit.Name + ' debe ser un entero entre 1 y ' + $limit.Maximum + '.')
        }
    }
    if ($effective.PRODUCT_IMAGES_CLEANUP_ENABLED -and
        $effective.PRODUCT_IMAGES_CLEANUP_ENABLED -notin @('true', 'false')) {
        Stop-BackendConfiguration 'PRODUCT_IMAGES_CLEANUP_ENABLED debe ser true o false.'
    }

    foreach ($name in $supportedNames) {
        $current = [System.Environment]::GetEnvironmentVariable($name, 'Process')
        if ([string]::IsNullOrEmpty($current) -and $fileValues.ContainsKey($name)) {
            $previousEnvironment[$name] = $current
            [System.Environment]::SetEnvironmentVariable($name, $effective[$name], 'Process')
        }
    }

    # Defense in depth for child output, including JDBC URLs that may contain
    # credentials. The launcher itself never prints configuration values.
    $redactions = @($effective.SPRING_DATASOURCE_PASSWORD, $effective.SUPABASE_STORAGE_SECRET_KEY, $effective.SUPABASE_DB_URL) |
        Where-Object { -not [string]::IsNullOrEmpty($_) } | Sort-Object Length -Descending
    Push-Location -LiteralPath $backendDirectory
    $locationPushed = $true
    Write-Host 'Configuracion verificada. Iniciando backend con Maven...'
    # Native stderr is ordinary output, not a terminating PowerShell exception.
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 1
    & $mavenWrapper spring-boot:run 2>&1 | ForEach-Object {
        $outputLine = $_.ToString()
        foreach ($sensitive in $redactions) { $outputLine = $outputLine.Replace($sensitive, '[REDACTED]') }
        Write-Output $outputLine
    }
    $launcherExitCode = $global:LASTEXITCODE
    if ($null -eq $launcherExitCode) { $launcherExitCode = 1 }
}
catch {
    $message = 'UniFood: No se pudo cargar la configuracion o iniciar Maven. No se muestran detalles para evitar exponer credenciales.'
    if ($_.Exception.Message.StartsWith('UniFood: ')) { $message = $_.Exception.Message }
    [Console]::Error.WriteLine($message)
    $launcherExitCode = 1
}
finally {
    if ($locationPushed) { Pop-Location }
    foreach ($name in $previousEnvironment.Keys) {
        [System.Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
}
exit $launcherExitCode
