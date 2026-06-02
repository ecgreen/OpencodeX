<#
.SYNOPSIS
    Installs the OpencodeX binary on Windows.

.DESCRIPTION
    Downloads the matching release artifact from GitHub Releases, or extracts a
    local build artifact, installs it to a user-local directory, adds it to PATH,
    and verifies the installation.

.PARAMETER ArtifactPath
    Path to a local artifact (.zip or .exe). Defaults to auto-detecting from
    artifacts/, then downloading from GitHub Releases.

.PARAMETER ReleaseRepo
    GitHub repository that hosts release assets. Defaults to opencodex/opencodex.

.PARAMETER Version
    Release version to install. Defaults to latest. Accepts values with or without
    a leading v, for example "1.15.13" or "v1.15.13".

.PARAMETER InstallDir
    Installation directory. Defaults to $env:LOCALAPPDATA\Programs\OpencodeX.

.PARAMETER BinaryName
    Name for the installed binary. Defaults to "opencodex.exe".

.PARAMETER NoPathUpdate
    Skip adding the install directory to the user's PATH.

.PARAMETER Uninstall
    Remove OpencodeX from the install directory and PATH.

.EXAMPLE
    .\install-windows.ps1
    # Downloads latest release asset, installs to default location

.EXAMPLE
    .\install-windows.ps1 -Version 1.15.13
    # Downloads a specific release asset

.EXAMPLE
    .\install-windows.ps1 -ArtifactPath .\artifacts\opencodex-windows-x64-baseline.zip
    # Install from a specific artifact

.EXAMPLE
    .\install-windows.ps1 -Uninstall
    # Remove the installation
#>

[CmdletBinding()]
param(
    [string]$ArtifactPath = "",
    [string]$ReleaseRepo = "opencodex/opencodex",
    [string]$Version = "latest",
    [string]$InstallDir = "",
    [string]$BinaryName = "opencodex.exe",
    [switch]$NoPathUpdate,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step  { param([string]$msg) Write-Host "`n--- $msg ---" -ForegroundColor Cyan }
function Write-Ok    { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param([string]$msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$msg) Write-Host "  [ERR] $msg" -ForegroundColor Red; exit 1 }

function Test-Avx2 {
    if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
        return $false
    }

    try {
        $type = Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);' -Name Kernel32 -Namespace Win32 -PassThru
        return $type::IsProcessorFeaturePresent(40)
    } catch {
        return $false
    }
}

function Get-ReleaseAssetName {
    $arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
        "Arm64" { "arm64" }
        "X64" { "x64" }
        default { Write-Err "Unsupported Windows architecture: $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" }
    }

    $target = "windows-$arch"
    if ($arch -eq "x64" -and -not (Test-Avx2)) {
        $target = "$target-baseline"
    }

    return "opencodex-$target.zip"
}

function Get-ReleaseAssetUrl {
    param([string]$AssetName)

    if ($Version -eq "latest") {
        return "https://github.com/$ReleaseRepo/releases/latest/download/$AssetName"
    }

    $tag = $Version
    if (-not $tag.StartsWith("v")) {
        $tag = "v$tag"
    }
    return "https://github.com/$ReleaseRepo/releases/download/$tag/$AssetName"
}

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\OpencodeX"
}

# ---------------------------------------------------------------------------
# Uninstall mode
# ---------------------------------------------------------------------------
if ($Uninstall) {
    Write-Step "Uninstalling OpencodeX"

    $exePath = Join-Path $InstallDir $BinaryName
    if (Test-Path $exePath) {
        Remove-Item $exePath -Force
        Write-Ok "Removed $exePath"
    } else {
        Write-Warn "Binary not found at $exePath"
    }

    # Remove from PATH
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -and $userPath.Contains($InstallDir)) {
        $parts = $userPath -split ";" | Where-Object { $_ -ne $InstallDir -and $_ -ne "" }
        $newPath = $parts -join ";"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Ok "Removed $InstallDir from user PATH"
    }

    # Clean up empty directory
    if ((Test-Path $InstallDir) -and @(Get-ChildItem $InstallDir).Count -eq 0) {
        Remove-Item $InstallDir -Force
        Write-Ok "Removed empty directory $InstallDir"
    }

    Write-Host "`nOpencodeX uninstalled." -ForegroundColor Green
    Write-Host "Restart your terminal for PATH changes to take effect.`n"
    exit 0
}

# ---------------------------------------------------------------------------
# Step 1: Find artifact
# ---------------------------------------------------------------------------
Write-Step "Locating artifact"

if (-not $ArtifactPath) {
    $artifactsDir = Join-Path $ScriptDir "artifacts"

    # Prefer .zip, then .exe
    $zips = if (Test-Path $artifactsDir) { @(Get-ChildItem -Path $artifactsDir -Filter "opencodex-windows-*.zip" -ErrorAction SilentlyContinue) } else { @() }
    $exes = if (Test-Path $artifactsDir) { @(Get-ChildItem -Path $artifactsDir -Filter "opencodex-windows-*.exe" -ErrorAction SilentlyContinue) } else { @() }

    if ($zips.Count -gt 0) {
        # Pick the most recent zip
        $ArtifactPath = ($zips | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    } elseif ($exes.Count -gt 0) {
        $ArtifactPath = ($exes | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    } else {
        $assetName = Get-ReleaseAssetName
        $downloadUrl = Get-ReleaseAssetUrl -AssetName $assetName
        $downloadDir = Join-Path $env:TEMP "opencodex-download"
        New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
        $ArtifactPath = Join-Path $downloadDir $assetName

        Write-Step "Downloading release artifact"
        Write-Host "  $downloadUrl" -ForegroundColor DarkGray
        try {
            Invoke-WebRequest -Uri $downloadUrl -OutFile $ArtifactPath
        } catch {
            Write-Err "Failed to download $assetName from $ReleaseRepo. Release assets may not exist yet: $_"
        }
    }
}

if (-not (Test-Path $ArtifactPath)) {
    Write-Err "Artifact not found: $ArtifactPath"
}

$artifactItem = Get-Item $ArtifactPath
$artifactSizeMB = [math]::Round($artifactItem.Length / 1MB, 1)
Write-Ok "Found: $ArtifactPath ($artifactSizeMB MB)"

# ---------------------------------------------------------------------------
# Step 2: Extract / copy binary
# ---------------------------------------------------------------------------
Write-Step "Installing binary"

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

$destPath = Join-Path $InstallDir $BinaryName
$isZip = $ArtifactPath.EndsWith(".zip")

if ($isZip) {
    $tempDir = Join-Path $env:TEMP "opencodex-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        Expand-Archive -Path $ArtifactPath -DestinationPath $tempDir -Force

        # Find the .exe inside the zip
        $extracted = Get-ChildItem -Path $tempDir -Filter "*.exe" -Recurse | Select-Object -First 1
        if (-not $extracted) {
            Write-Err "No .exe found inside the zip archive"
        }

        Copy-Item $extracted.FullName $destPath -Force
    } finally {
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Copy-Item $ArtifactPath $destPath -Force
}

$installedItem = Get-Item $destPath
$installedSizeMB = [math]::Round($installedItem.Length / 1MB, 1)
Write-Ok "Installed: $destPath ($installedSizeMB MB)"

# ---------------------------------------------------------------------------
# Step 3: Update PATH
# ---------------------------------------------------------------------------
if (-not $NoPathUpdate) {
    Write-Step "Updating PATH"

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -and $userPath.Contains($InstallDir)) {
        Write-Ok "PATH already contains $InstallDir"
    } else {
        if ($userPath) {
            $newPath = "$InstallDir;$userPath"
        } else {
            $newPath = $InstallDir
        }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Ok "Added $InstallDir to user PATH"

        # Also update current session
        $env:Path = "$InstallDir;$env:Path"
    }
} else {
    Write-Warn "Skipping PATH update (--NoPathUpdate)"
}

# ---------------------------------------------------------------------------
# Step 4: Verify installation
# ---------------------------------------------------------------------------
Write-Step "Verifying installation"

try {
    $versionOutput = & $destPath --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Version: $versionOutput"
    } else {
        Write-Warn "Binary exited with code $LASTEXITCODE"
        Write-Warn "Output: $versionOutput"
    }
} catch {
    Write-Warn "Could not run --version check: $_"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "OpencodeX installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Binary:  $destPath" -ForegroundColor DarkGray
$cmdName = $BinaryName -replace '\.exe$', ''
Write-Host "  Command: $cmdName" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Restart your terminal, then run:" -ForegroundColor DarkGray
Write-Host "    opencodex" -ForegroundColor White
Write-Host ""
Write-Host "  To uninstall:" -ForegroundColor DarkGray
Write-Host "    .\install-windows.ps1 -Uninstall" -ForegroundColor White
Write-Host ""
