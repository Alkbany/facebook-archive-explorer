$ErrorActionPreference = 'Stop'

$releaseDirectory = Join-Path (Get-Location) 'release'
$unpackedDirectory = Join-Path $releaseDirectory 'win-unpacked'
$mainExecutable = Join-Path $unpackedDirectory 'Facebook Archive Explorer.exe'
$setupInstallers = @(Get-ChildItem -LiteralPath $releaseDirectory -File -Filter '*Setup*.exe' -ErrorAction SilentlyContinue)

if (-not (Test-Path -LiteralPath $unpackedDirectory -PathType Container)) {
  throw "Electron unpacked output is missing: $unpackedDirectory"
}

if (-not (Test-Path -LiteralPath $mainExecutable -PathType Leaf)) {
  throw "Packaged application executable is missing: $mainExecutable"
}

if ($setupInstallers.Count -ne 1) {
  throw "Expected exactly one NSIS Setup installer, found $($setupInstallers.Count)."
}

$setupInstaller = $setupInstallers[0]
if ($setupInstaller.Length -lt 10MB) {
  throw "The NSIS installer looks incomplete: $($setupInstaller.Length) bytes."
}

$applicationVersion = (Get-Item -LiteralPath $mainExecutable).VersionInfo.ProductVersion
$setupHash = (Get-FileHash -LiteralPath $setupInstaller.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

@(
  "Application product version: $applicationVersion"
  "Installer file: $($setupInstaller.Name)"
  "Installer size: $($setupInstaller.Length) bytes"
  "Installer SHA-256: $setupHash"
) | Set-Content -LiteralPath (Join-Path $releaseDirectory 'build-verification.txt') -Encoding utf8

Write-Host "Verified installer: $($setupInstaller.Name)"
Write-Host "SHA-256: $setupHash"
