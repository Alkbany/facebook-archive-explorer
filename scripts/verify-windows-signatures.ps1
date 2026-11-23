$ErrorActionPreference = 'Stop'

$releaseDirectory = Join-Path (Get-Location) 'release'
if (-not (Test-Path -LiteralPath $releaseDirectory -PathType Container)) {
  throw "Release directory was not created: $releaseDirectory"
}

$extensions = @('.exe', '.dll', '.node')
$binaries = @(Get-ChildItem -LiteralPath $releaseDirectory -Recurse -File |
  Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() })

if ($binaries.Count -eq 0) {
  throw 'No Windows executable binaries were found to verify.'
}

$codeSigningEku = '1.3.6.1.5.5.7.3.3'
$failures = @()

foreach ($binary in $binaries) {
  $signature = Get-AuthenticodeSignature -LiteralPath $binary.FullName

  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    $failures += "$($binary.FullName): signature status is $($signature.Status)"
    continue
  }

  if ($null -eq $signature.SignerCertificate) {
    $failures += "$($binary.FullName): signer certificate is missing"
    continue
  }

  $ekuOids = @()
  $ekuExtensions = @($signature.SignerCertificate.Extensions |
    Where-Object { $_.Oid.Value -eq '2.5.29.37' })
  foreach ($extension in $ekuExtensions) {
    $parsedEku = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new(
      $extension,
      $extension.Critical
    )
    $ekuOids += @($parsedEku.EnhancedKeyUsages | ForEach-Object { $_.Value })
  }
  if ($codeSigningEku -notin $ekuOids) {
    $failures += "$($binary.FullName): signer certificate does not include the Code Signing EKU"
    continue
  }

  Write-Host "Valid Authenticode signature: $($binary.Name) — $($signature.SignerCertificate.Subject)"
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Error $_ }
  throw "Windows signing verification failed for $($failures.Count) binary/binaries."
}

Write-Host "Verified $($binaries.Count) signed Windows binaries."
