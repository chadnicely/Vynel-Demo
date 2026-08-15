<#
.SYNOPSIS
  Create (once) Vynel's own self-signed code-signing certificate for TEST-signing
  the call-audio driver, and export its public .cer for a VM to trust.

.DESCRIPTION
  This is our LOCAL signature - it lets us build, load (in a VM), and test the
  driver ourselves without Partner Center. It is NOT for public distribution:
  shipping to the community needs attestation signing (Partner Center + EV
  cert), which replaces the signtool step, not this whole flow. Test-signed
  drivers load only with test-signing mode ON (a VM), never on a normal machine.

  Idempotent: reuses the existing cert if one with our subject is already in the
  CurrentUser\My store. The PRIVATE key stays in the store (never written to
  disk / never committed); only the public .cer is exported (safe to commit -
  it is what a VM imports to trust our signature).

.NOTES
  Run once per build machine. The cert is valid 10 years so the test loop is
  stable. Remove with: Get-ChildItem Cert:\CurrentUser\My |
    ? { $_.Subject -eq 'CN=Vynel Driver Test' } | Remove-Item
#>
param(
    [string]$Subject = 'CN=Vynel Driver Test',
    [string]$PublicCerPath = "$PSScriptRoot\VynelDriverTest.cer"
)

$ErrorActionPreference = 'Stop'

$existing = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $Subject } |
    Select-Object -First 1

if ($existing) {
    Write-Host "Reusing existing cert: $($existing.Thumbprint)"
    $cert = $existing
}
else {
    Write-Host "Creating self-signed code-signing cert '$Subject'..."
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $Subject `
        -CertStoreLocation Cert:\CurrentUser\My `
        -KeyExportPolicy Exportable `
        -KeyUsage DigitalSignature `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(10)
    Write-Host "Created: $($cert.Thumbprint)"
}

# Export the PUBLIC certificate only (no private key) for VM trust + commit.
Export-Certificate -Cert $cert -FilePath $PublicCerPath -Type CERT -Force | Out-Null
Write-Host "Public cert exported: $PublicCerPath"
Write-Host "Thumbprint: $($cert.Thumbprint)"
