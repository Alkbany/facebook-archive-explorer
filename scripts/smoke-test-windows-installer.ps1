$ErrorActionPreference = 'Stop'

$releaseDirectory = Join-Path (Get-Location) 'release'
$installers = @(Get-ChildItem -LiteralPath $releaseDirectory -File -Filter '*Setup*.exe')
if ($installers.Count -ne 1) {
  throw "Expected exactly one NSIS installer for the lifecycle smoke test; found $($installers.Count)."
}

$smokeRoot = Join-Path $env:RUNNER_TEMP 'facebook-archive-explorer-installer-smoke'
$installDirectory = Join-Path $smokeRoot 'installed'
$appExecutable = Join-Path $installDirectory 'Facebook Archive Explorer.exe'
$taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'

function Get-InstalledAppProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = 'Facebook Archive Explorer.exe'" |
    Where-Object {
      $_.ExecutablePath -and
      [string]::Equals($_.ExecutablePath, $appExecutable, [System.StringComparison]::OrdinalIgnoreCase)
    })
}

function Stop-InstalledAppProcesses {
  foreach ($process in (Get-InstalledAppProcesses)) {
    & $taskkill /PID $process.ProcessId /T /F 2>$null | Out-Null
  }
}

function Wait-ForInstalledAppExit([int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $remaining = @(Get-InstalledAppProcesses)
    if ($remaining.Count -eq 0) { return }
    Stop-InstalledAppProcesses
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  $remaining = @(Get-InstalledAppProcesses)
  if ($remaining.Count -gt 0) {
    $pids = ($remaining | ForEach-Object { $_.ProcessId }) -join ', '
    throw "The installed application still has running processes: $pids"
  }
}

function Wait-ForProcess([System.Diagnostics.Process]$Process, [int]$TimeoutMilliseconds, [string]$Description) {
  if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
    & $taskkill /PID $Process.Id /T /F 2>$null | Out-Null
    throw "$Description did not finish within $TimeoutMilliseconds ms."
  }
}

try {
  if (Test-Path -LiteralPath $smokeRoot) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null

  # /D must be the final NSIS argument. RUNNER_TEMP has no spaces on hosted Windows runners.
  $installerProcess = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$installDirectory") -PassThru
  Wait-ForProcess $installerProcess 180000 'Silent NSIS installation'
  if ($installerProcess.ExitCode -ne 0) {
    throw "NSIS installation failed with exit code $($installerProcess.ExitCode)."
  }

  if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
    throw "Installed application executable is missing: $appExecutable"
  }

  # Verify the main process remains alive through startup. This does not replace
  # the manual clean-device UI smoke test.
  $appProcess = Start-Process -FilePath $appExecutable -WorkingDirectory $installDirectory -PassThru
  if ($appProcess.WaitForExit(15000)) {
    throw "The installed application exited during startup with code $($appProcess.ExitCode)."
  }

  Stop-InstalledAppProcesses
  Wait-ForInstalledAppExit 30

  $uninstallers = @(Get-ChildItem -LiteralPath $installDirectory -File -Filter 'Uninstall*.exe')
  if ($uninstallers.Count -ne 1) {
    throw "Expected one installed uninstaller; found $($uninstallers.Count)."
  }

  $uninstallerProcess = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList @('/S') -PassThru
  Wait-ForProcess $uninstallerProcess 180000 'Silent NSIS uninstall'
  if ($uninstallerProcess.ExitCode -ne 0) {
    throw "NSIS uninstall failed with exit code $($uninstallerProcess.ExitCode)."
  }

  # NSIS may complete its final file cleanup just after the uninstaller process exits.
  $uninstallDeadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Test-Path -LiteralPath $appExecutable) -and [DateTime]::UtcNow -lt $uninstallDeadline) {
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $appExecutable) {
    $remainingProcesses = @(Get-InstalledAppProcesses)
    $pids = ($remainingProcesses | ForEach-Object { $_.ProcessId }) -join ', '
    throw "The application executable remains after uninstall. Remaining process IDs: $pids"
  }

  Write-Host 'Windows installer lifecycle smoke test passed: install, launch, and uninstall.'
}
finally {
  Stop-InstalledAppProcesses
  if (Test-Path -LiteralPath $smokeRoot) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
