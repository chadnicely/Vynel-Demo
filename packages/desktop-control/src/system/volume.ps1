# volume.ps1  (vendored asset of @vynel/desktop-control)
#
# Reads or changes the default output device's volume via the CoreAudio
# IAudioEndpointVolume COM interface, and prints ONE JSON line either way:
#   {"level":37,"muted":false}
#
# WHY vendored PowerShell and not the cross-platform `loudness` package: its
# Windows impl is a bundled pre-compiled unsigned exe — the same objection that
# ruled out node-notifier's SnoreToast.exe. This file is auditable text on the
# same pattern as the package's other two helpers.
#
# Args ride ENVIRONMENT VARIABLES (the launch-app lesson):
#   VYNEL_VOLUME_LEVEL  0-100  (optional — omit to leave the level alone)
#   VYNEL_VOLUME_MUTE   true|false  (optional — omit to leave mute alone)
# With neither set this is a pure read.

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumerator { }

// ALL COM calls stay inside C#: PowerShell's dynamic dispatch cannot call
// through a raw COM interface pointer (a __ComObject has no visible methods),
// so the script only ever touches these plain static methods.
public static class VynelAudio {
    static IAudioEndpointVolume Endpoint() {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
        var iid = typeof(IAudioEndpointVolume).GUID;
        object endpoint;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 1, IntPtr.Zero, out endpoint));
        return (IAudioEndpointVolume)endpoint;
    }
    public static int GetLevel() {
        float scalar;
        Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out scalar));
        return (int)Math.Round(scalar * 100);
    }
    public static bool GetMuted() {
        bool muted;
        Marshal.ThrowExceptionForHR(Endpoint().GetMute(out muted));
        return muted;
    }
    public static void SetLevel(int level) {
        Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(level / 100f, Guid.Empty));
    }
    public static void SetMuted(bool muted) {
        Marshal.ThrowExceptionForHR(Endpoint().SetMute(muted, Guid.Empty));
    }
}
'@

if ($env:VYNEL_VOLUME_LEVEL -ne $null -and "$env:VYNEL_VOLUME_LEVEL" -ne "") {
    $level = [int]$env:VYNEL_VOLUME_LEVEL
    if ($level -lt 0 -or $level -gt 100) {
        [Console]::Error.WriteLine("volume: VYNEL_VOLUME_LEVEL must be 0-100, got $level")
        exit 1
    }
    [VynelAudio]::SetLevel($level)
}
if ("$env:VYNEL_VOLUME_MUTE" -eq "true") {
    [VynelAudio]::SetMuted($true)
} elseif ("$env:VYNEL_VOLUME_MUTE" -eq "false") {
    [VynelAudio]::SetMuted($false)
}

# Always read back the VERIFIED end state — what the device reports, not what
# was asked for (the set_window_state precedent).
$state = [ordered]@{
    level = [VynelAudio]::GetLevel()
    muted = [VynelAudio]::GetMuted()
}
[Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
