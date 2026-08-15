<#
.SYNOPSIS
  Purge Windows' cached audio-endpoint entries for Vynel devices so
  AudioEndpointBuilder rebuilds them with freshly composed names.

.DESCRIPTION
  Endpoint display names are composed ONCE at endpoint creation and persisted
  under HKLM\...\MMDevices. After a driver rename (pin-name GUIDs /
  DeviceDesc), a re-matched endpoint keeps its stale cached name — e.g.
  "Speakers (Vynel Audio)" instead of "Vynel Call 1 Voice (Vynel Audio)".
  This deletes ONLY endpoints whose cached name contains "Vynel" (real
  devices untouched), cycling the audio services around the delete. Audio
  drops for a couple of seconds. Self-elevates via UAC if needed.
#>

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
    )
    exit
}

# PKEY_Device_DeviceDesc (,2) holds the composed left half; PKEY_Device_FriendlyName (,14) the full name.
$descKey = '{a45c254e-df1c-4efd-8020-67d146a850e0},2'
$nameKey = '{a45c254e-df1c-4efd-8020-67d146a850e0},14'

Write-Host 'Stopping audio services...'
Stop-Service Audiosrv, AudioEndpointBuilder -Force

# The services MUST come back even if every delete fails — a dead Audiosrv is
# worse than a stale name (learned the hard way 2026-08-14: one access-denied
# key killed the run pre-restart and left the machine mute).
$deleted = 0
$failed = 0
try {
    foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render',
                      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture') {
        Get-ChildItem $root | ForEach-Object {
            $props = Get-ItemProperty "$($_.PSPath)\Properties" -ErrorAction SilentlyContinue
            $cachedNames = @($props.$descKey, $props.$nameKey) -join ' '
            if ($cachedNames -match 'Vynel') {
                try {
                    Remove-Item $_.PSPath -Recurse -Force -ErrorAction Stop
                    Write-Host "  deleted $($_.PSChildName): $cachedNames"
                    $deleted++
                } catch {
                    Write-Warning "  FAILED $($_.PSChildName): $cachedNames -- $($_.Exception.Message)"
                    $failed++
                }
            }
        }
    }
} finally {
    Write-Host 'Restarting audio services...'
    Start-Service AudioEndpointBuilder, Audiosrv
    Start-Sleep -Seconds 3
}
if ($failed -gt 0) {
    Write-Warning "$failed endpoint(s) could not be deleted (key ACLs) - their cached names remain."
}

Write-Host "`nPurged $deleted cached endpoint(s). Devices now:"
Get-PnpDevice -FriendlyName '*Vynel*' | Format-Table FriendlyName, Status

Read-Host 'Done - press Enter to close'
