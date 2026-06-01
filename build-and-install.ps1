<#
.SYNOPSIS
    Build OpencodeX in WSL and install the result on Windows - one command.

.DESCRIPTION
    This script:
    1. Detects WSL and converts the repo path to a WSL-accessible mount
    2. Invokes build.sh inside WSL to cross-compile for Windows
    3. Runs install-windows.ps1 to install the built artifact

    This is the primary developer workflow for building and testing on Windows.

.PARAMETER Target
    Build target passed to build.sh. Default: win32-x64-baseline

.PARAMETER Minify
    Enable minification in the build.

.PARAMETER Clean
    Wipe the WSL /tmp/OpencodeX build directory before building.

.PARAMETER SkipInstall
    Only build; don't install.

.PARAMETER InstallDir
    Override the install directory (passed to install-windows.ps1).

.PARAMETER Distro
    WSL distribution name. Default: auto-detect default distro.

.EXAMPLE
    .\build-and-install.ps1
    # Build and install with defaults

.EXAMPLE
    .\build-and-install.ps1 -Clean
    # Clean build from scratch, then install

.EXAMPLE
    .\build-and-install.ps1 -SkipInstall
    # Build only, don't install
#>

[CmdletBinding()]
param(
    [string]$Target = "win32-x64-baseline",
    [switch]$Minify,
    [switch]$Clean,
    [switch]$SkipInstall,
    [string]$InstallDir = "",
    [string]$Distro = ""
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Banner {
    Write-Host ""
    Write-Host "  +======================================+" -ForegroundColor DarkCyan
    Write-Host "  |     OpencodeX Build & Install        |" -ForegroundColor DarkCyan
    Write-Host "  +======================================+" -ForegroundColor DarkCyan
    Write-Host ""
}

function Write-Step  { param([string]$msg) Write-Host "`n--- $msg ---" -ForegroundColor Cyan }
function Write-Ok    { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err   { param([string]$msg) Write-Host "  [ERR] $msg" -ForegroundColor Red; exit 1 }
function Write-Warn  { param([string]$msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

Write-Banner
$startTime = Get-Date

# ---------------------------------------------------------------------------
# Step 1: Check WSL
# ---------------------------------------------------------------------------
Write-Step "Checking WSL"

$wslExe = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wslExe) {
    Write-Err "WSL not found. Install WSL: wsl --install"
}

# Check WSL is running
try {
    $null = wsl.exe --status 2>&1
    Write-Ok "WSL available"
} catch {
    Write-Err "WSL is not running. Start it with: wsl"
}

# Determine distro
if (-not $Distro) {
    # Parse default distro from wsl -l -v
    $distroList = wsl.exe -l -v 2>&1 | Out-String
    # The default distro has a * prefix
    $defaultMatch = [regex]::Match($distroList, '\*\s+(\S+)')
    if ($defaultMatch.Success) {
        $Distro = $defaultMatch.Groups[1].Value
        Write-Ok "Using default distro: $Distro"
    } else {
        Write-Warn "Could not detect default WSL distro, using wsl.exe without -d flag"
    }
}

# ---------------------------------------------------------------------------
# Step 2: Convert repo path to WSL mount path
# ---------------------------------------------------------------------------
Write-Step "Resolving paths"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path $ScriptDir).Path

# Convert Windows path to WSL path: C:\Work\OpencodeX -> /mnt/c/Work/OpencodeX
$driveLetter = $RepoRoot.Substring(0, 1).ToLower()
$wslPath = "/mnt/$driveLetter" + ($RepoRoot.Substring(2) -replace '\\', '/')

Write-Ok "Windows: $RepoRoot"
Write-Ok "WSL:     $wslPath"

# ---------------------------------------------------------------------------
# Step 3: Build in WSL
# ---------------------------------------------------------------------------
Write-Step "Building in WSL (target: $Target)"

$buildArgs = @("--target", $Target)

if ($Minify) {
    $buildArgs += "--minify"
}

if ($Clean) {
    $buildArgs += "--clean"
}

$buildArgsStr = $buildArgs -join ' '
$buildCmd = "cd '$wslPath' && bash build.sh $buildArgsStr"
Write-Host "  Running: wsl bash -c `"$buildCmd`"" -ForegroundColor DarkGray

$wslArgs = @()
if ($Distro) {
    $wslArgs += @("-d", $Distro)
}
$wslArgs += @("bash", "-c", $buildCmd)

& wsl.exe @wslArgs
$buildExitCode = $LASTEXITCODE

if ($buildExitCode -ne 0) {
    Write-Err "Build failed with exit code $buildExitCode"
}

Write-Ok "Build completed"

# ---------------------------------------------------------------------------
# Step 4: Install on Windows
# ---------------------------------------------------------------------------
if ($SkipInstall) {
    Write-Warn "Skipping install (-SkipInstall)"
    Write-Host "`n  To install manually:" -ForegroundColor DarkGray
    Write-Host "    .\install-windows.ps1" -ForegroundColor White
} else {
    Write-Step "Installing on Windows"

    $installScript = Join-Path $ScriptDir "install-windows.ps1"
    if (-not (Test-Path $installScript)) {
        Write-Err "install-windows.ps1 not found at $installScript"
    }

    $installArgs = @()
    if ($InstallDir) {
        $installArgs += @("-InstallDir", $InstallDir)
    }

    & $installScript @installArgs
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
Write-Host ""
Write-Host "  Done! (${elapsed}s total)" -ForegroundColor Green
Write-Host ""
