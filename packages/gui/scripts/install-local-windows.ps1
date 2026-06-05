param(
  [string]$Installer = (Join-Path $PSScriptRoot "..\release\OpencodeX Setup 1.15.13.exe"),
  [switch]$Launch
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "install-local-windows.ps1 can only be used on Windows."
}

$installerPath = Resolve-Path -LiteralPath $Installer

function Get-GuiInstallDirs {
  $dirs = New-Object System.Collections.Generic.List[string]
  $fallback = Join-Path $env:LOCALAPPDATA "Programs\@opencode-aigui"
  $dirs.Add($fallback)

  $uninstallRoots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )

  foreach ($root in $uninstallRoots) {
    Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like "OpencodeX*" -and $_.UninstallString } |
      ForEach-Object {
        $match = [regex]::Match($_.UninstallString, '^"(?<path>[^"]+)"')
        if ($match.Success) {
          $dirs.Add((Split-Path -Parent $match.Groups["path"].Value))
        }
      }
  }

  $dirs | Select-Object -Unique
}

function Stop-InstalledGuiOnly {
  $guiPaths = Get-GuiInstallDirs |
    ForEach-Object { @(
      Join-Path $_ "opencodex-gui.exe"
      Join-Path $_ "OpencodeX.exe"
    ) } |
    Where-Object { Test-Path -LiteralPath $_ } |
    ForEach-Object { [System.IO.Path]::GetFullPath($_) }

  if (-not $guiPaths) { return }

  Get-Process -Name "opencodex-gui", "OpencodeX" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $processPath = [System.IO.Path]::GetFullPath($_.Path)
      if ($guiPaths -contains $processPath) {
        Stop-Process -Id $_.Id -Force
      }
    } catch {
      # Ignore inaccessible system processes. Never fall back to process-name killing.
    }
  }
}

Stop-InstalledGuiOnly

$process = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
if ($process.ExitCode -ne 0) {
  throw "OpencodeX GUI installer failed with exit code $($process.ExitCode)."
}

if ($Launch) {
  $app = Get-GuiInstallDirs |
    ForEach-Object { @(
      Join-Path $_ "opencodex-gui.exe"
      Join-Path $_ "OpencodeX.exe"
    ) } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1

  if (-not $app) {
    throw "Installed OpencodeX GUI executable was not found."
  }

  Start-Process -FilePath $app -WorkingDirectory (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\.."))
}
