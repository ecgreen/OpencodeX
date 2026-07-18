param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TestFiles,
  [int]$MaxCpuCores = 2,
  [int]$MaxMemoryMb = 2500,
  [switch]$Electron
)

$ErrorActionPreference = "Stop"
$gui = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $gui ".artifacts\host-e2e"
$started = Get-Date
$existing = Get-Process chrome, electron, opencodex-gui -ErrorAction SilentlyContinue

if ($existing) {
  throw "Host E2E requires Chrome and Electron to be closed so only one controlled instance can run."
}

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$bun = (Get-Command bun).Source
$arguments = @("x", "playwright", "test", "--workers=1") + $(if ($Electron) { @("--config=playwright.electron.config.ts") } else { @() }) + $TestFiles
$previousHostChrome = $env:OPENCODEX_GUI_E2E_HOST_CHROME
if (-not $Electron) { $env:OPENCODEX_GUI_E2E_HOST_CHROME = "1" }

$current = [Diagnostics.Process]::GetCurrentProcess()
$current.PriorityClass = "BelowNormal"
$cores = [Math]::Max(1, [Math]::Min($MaxCpuCores, [Environment]::ProcessorCount))
$mask = [int64]0
0..($cores - 1) | ForEach-Object { $mask = $mask -bor ([int64]1 -shl $_) }
$current.ProcessorAffinity = [IntPtr]$mask

$targetNames = if ($Electron) { @("electron", "opencodex-gui") } else { @("chrome") }
$targetLabel = if ($Electron) { "Electron application" } else { "headless Chrome instance" }
Write-Output "Starting one $targetLabel with $cores CPU cores, below-normal priority, GPU flags, and one Playwright worker."
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $bun
$start.WorkingDirectory = $gui
$start.UseShellExecute = $false
$start.Arguments = ($arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join " "
$run = New-Object Diagnostics.Process
$run.StartInfo = $start
if (-not $run.Start()) { throw "Failed to start the guarded Playwright process." }
$peakMemory = 0L
$aborted = $false

try {
  while (-not $run.HasExited) {
    Start-Sleep -Milliseconds 750
    $visualProcesses = Get-Process $targetNames -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $started }
    $sum = ($visualProcesses | Measure-Object -Property WorkingSet64 -Sum).Sum
    $memory = if ($null -eq $sum) { 0L } else { [int64]$sum }
    $peakMemory = [Math]::Max($peakMemory, $memory)
    if ($memory -le $MaxMemoryMb * 1MB) { continue }
    $aborted = $true
    Stop-Process -Id $run.Id -ErrorAction SilentlyContinue
    break
  }
  $run.WaitForExit()
} finally {
  if ($null -eq $previousHostChrome) {
    Remove-Item Env:OPENCODEX_GUI_E2E_HOST_CHROME -ErrorAction SilentlyContinue
  } else {
    $env:OPENCODEX_GUI_E2E_HOST_CHROME = $previousHostChrome
  }
  Start-Sleep -Milliseconds 500
  Get-Process $targetNames -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -ge $started } |
    Stop-Process -ErrorAction SilentlyContinue
}

Write-Output ("Peak controlled {0} memory: {1:N0} MB" -f $targetLabel, ($peakMemory / 1MB))

if ($aborted) {
  throw "Host E2E exceeded the $MaxMemoryMb MB browser memory limit and was stopped."
}

exit $run.ExitCode
