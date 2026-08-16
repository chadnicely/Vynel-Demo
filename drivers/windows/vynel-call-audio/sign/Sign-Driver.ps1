<#
.SYNOPSIS
  Stamp, catalog, and TEST-sign the built driver package with Vynel's own
  self-signed certificate, then verify the signatures.

.DESCRIPTION
  Runs against the build output package dir (default:
  ...\VynelCallAudio\Driver\x64\Release\VynelCallAudio). It:
    1. Stamps the INF with a FIXED past DriverVer date - sidestepping the WDK's
       auto-"today" stamp, which inf2cat rejects as "postdated" when the build
       machine's local clock is ahead of UTC.
    2. Rebuilds the catalog (Inf2Cat) so it matches the stamped INF + .sys.
    3. Signs the .sys and the .cat with our cert (from New-VynelTestCert.ps1).
    4. Verifies both signatures.

  This is our LOCAL test-sign loop. Public distribution swaps step 3+4 for
  attestation signing (Partner Center + EV) - see README.md.

  Needs the EWDK build environment on PATH (signtool/stampinf/inf2cat), e.g.
  run inside `<EWDK>:\BuildEnv\SetupBuildEnv.cmd`, or pass -KitBin.
#>
param(
    [string]$PackageDir = "$PSScriptRoot\..\VynelCallAudio\Driver\x64\Release\VynelCallAudio",
    [string]$Subject = 'CN=Vynel Driver Test',
    [string]$DriverVer = '01/01/2026,0.1.0.5',
    [string]$KitBin = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-KitTool([string]$name, [string]$arch) {
    if ($KitBin -and (Test-Path "$KitBin\$arch\$name")) { return "$KitBin\$arch\$name" }
    $onPath = Get-Command $name -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $found = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin', 'I:\Program Files\Windows Kits\10\bin' `
        -Recurse -Filter $name -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*\$arch\*" } | Select-Object -First 1
    if (-not $found) { throw "$name not found - run inside the EWDK build env or pass -KitBin." }
    return $found.FullName
}

$inf = Join-Path $PackageDir 'VynelCallAudio.inf'
$sys = Join-Path $PackageDir 'VynelCallAudio.sys'
$cat = Join-Path $PackageDir 'vynelcallaudio.cat'
if (-not (Test-Path $inf)) { throw "INF not found at $inf - build the driver first." }
if (-not (Test-Path $sys)) { throw "SYS not found at $sys - build the driver first." }

$stampinf = Resolve-KitTool 'stampinf.exe' 'x64'
$inf2cat  = Resolve-KitTool 'Inf2Cat.exe' 'x86'
$signtool = Resolve-KitTool 'signtool.exe' 'x64'

$cert = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $Subject } | Select-Object -First 1
if (-not $cert) { throw "Cert '$Subject' not found - run New-VynelTestCert.ps1 first." }

Write-Host "Stamping DriverVer=$DriverVer (fixed, past - dodges the UTC clock skew)..."
& $stampinf -f $inf -d $DriverVer.Split(',')[0] -v $DriverVer.Split(',')[1]
if ($LASTEXITCODE -ne 0) { throw "stampinf failed ($LASTEXITCODE)" }

Write-Host 'Building catalog (Inf2Cat, Windows 10 x64)...'
& $inf2cat /driver:$PackageDir /os:10_X64 /verbose | Out-Null
if ($LASTEXITCODE -ne 0) { throw "inf2cat failed ($LASTEXITCODE)" }

Write-Host 'Test-signing .sys and .cat with the Vynel cert...'
& $signtool sign /v /fd sha256 /sha1 $cert.Thumbprint /s My $sys
if ($LASTEXITCODE -ne 0) { throw "signtool sign (.sys) failed ($LASTEXITCODE)" }
& $signtool sign /v /fd sha256 /sha1 $cert.Thumbprint /s My $cat
if ($LASTEXITCODE -ne 0) { throw "signtool sign (.cat) failed ($LASTEXITCODE)" }

Write-Host 'Verifying the signatures are ours...'
# We assert the files are signed by OUR cert. We deliberately do NOT require a
# trusted chain here: a self-signed test cert is untrusted on the build box by
# design (only a VM that imports VynelDriverTest.cer trusts it), so a full
# /pa trust-verify SHOULD report "untrusted root" off-VM. Get-AuthenticodeSignature
# reports the signer even when the chain is untrusted.
$allOurs = $true
foreach ($file in @($sys, $cat)) {
    $sig = Get-AuthenticodeSignature $file
    $ours = $sig.SignerCertificate -and $sig.SignerCertificate.Thumbprint -eq $cert.Thumbprint
    if (-not $ours) { $allOurs = $false }
    $trust = if ($sig.Status -eq 'Valid') { 'trusted here' } else { "$($sig.Status) (untrusted root off-VM = expected)" }
    Write-Host ("  {0}: signer={1} [{2}]" -f (Split-Path $file -Leaf),
        ($(if ($ours) { 'Vynel' } else { 'NOT OURS' })), $trust)
}
if (-not $allOurs) { throw 'a file is not signed by the Vynel cert' }

Write-Host ''
Write-Host "Signed with: $($cert.Subject)  [$($cert.Thumbprint)]"
Write-Host "Package: $PackageDir"
Write-Host 'Load it in a VM per LOADING.md (test-signing mode + trust VynelDriverTest.cer).'
