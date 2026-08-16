import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Logger } from 'pino'

// The system-level slider of "Vynel Call <n> Microphone" is writable by ANY
// app — and a call app's auto-gain does write it (found live at 8%: the far
// end heard Vynel quiet and garbled while every local smoke measured the
// cable at unity). The cable IS unity by construction, so 100% is the mic's
// one designed operating point; restoring it at every call start makes a
// call's level deterministic no matter what dragged the slider since the
// last one. Best-effort by contract: a failed restore logs and never blocks
// the call. If a slider is seen drifting DURING calls too, the next step is
// a periodic re-assert while a call is live — deliberately not built until
// a start-time restore proves insufficient.

const execFileAsync = promisify(execFile)

export interface MicLevelReport {
  readonly name: string
  readonly beforePercent: number
  readonly afterPercent: number
  readonly wasMuted: boolean
}

/** Injectable PowerShell seam — tests fake it; the real one shells out. */
export type EncodedPowerShellRunner = (encodedCommand: string) => Promise<{ stdout: string }>

// -EncodedCommand keeps the multi-line script out of quoting territory
// entirely; nothing user-controlled rides into the shell. Bounded generously:
// Add-Type compiles C# on first use (~seconds).
export const runEncodedPowerShell: EncodedPowerShellRunner = async (encodedCommand) =>
  execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
    timeout: 15_000,
    windowsHide: true,
  })

/** Set every active "Vynel Call" capture endpoint to 100% + unmuted, reporting
 *  each endpoint's before/after. Never throws — an unrestorable slider is a
 *  logged warning, not a failed call. */
export async function restoreCallMicLevels(
  logger: Logger,
  runPowerShell: EncodedPowerShellRunner = runEncodedPowerShell,
): Promise<MicLevelReport[]> {
  let stdout: string
  try {
    ;({ stdout } = await runPowerShell(ENCODED_RESTORE_SCRIPT))
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'call mic level restore failed — the call proceeds at whatever level the slider holds',
    )
    return []
  }
  const reports: MicLevelReport[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed) as MicLevelReport
      if (typeof parsed.name !== 'string' || typeof parsed.beforePercent !== 'number') continue
      reports.push(parsed)
    } catch {
      continue // partial console noise around the JSON lines — skip, keep the rest
    }
  }
  for (const report of reports) {
    if (report.beforePercent < 100 || report.wasMuted) {
      // Info, not debug: recurring drift here is the tell that something rides
      // the slider mid-call and the periodic re-assert is warranted.
      logger.info({ ...report }, 'call mic level restored')
    } else {
      logger.debug({ ...report }, 'call mic level already at 100%')
    }
  }
  return reports
}

// The COM recipe: enumerate ACTIVE capture endpoints, match "Vynel Call",
// print a JSON report line per endpoint, set 100% + unmute.
const RESTORE_SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace VynelMicLevel {

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int pcDevices);
    [PreserveSig] int Item(int nDevice, out IMMDevice ppDevice);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    [PreserveSig] int GetState(out int pdwState);
}

[StructLayout(LayoutKind.Sequential)]
struct PropertyKey { public Guid fmtid; public int pid; }

[StructLayout(LayoutKind.Explicit)]
struct PropVariant {
    [FieldOffset(0)] public short vt;
    [FieldOffset(8)] public IntPtr pointerValue;
}

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
    [PreserveSig] int GetCount(out int cProps);
    [PreserveSig] int GetAt(int iProp, out PropertyKey pkey);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant pv);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int GetChannelCount(out uint channelCount);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid eventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channelNumber, float level, ref Guid eventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channelNumber, float level, ref Guid eventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint channelNumber, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channelNumber, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public static class Restore {
    public static string Run() {
        var report = new System.Text.StringBuilder();
        var enumerator = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorComObject();
        var nameKey = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        var volumeIid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        var context = Guid.Empty;
        IMMDeviceCollection collection;
        if (enumerator.EnumAudioEndpoints(1, 1, out collection) != 0) return ""; // eCapture, ACTIVE
        int count;
        collection.GetCount(out count);
        for (int i = 0; i < count; i++) {
            IMMDevice device;
            if (collection.Item(i, out device) != 0) continue;
            IPropertyStore store;
            if (device.OpenPropertyStore(0, out store) != 0) continue;
            PropVariant value;
            if (store.GetValue(ref nameKey, out value) != 0) continue;
            string name = Marshal.PtrToStringUni(value.pointerValue);
            if (name == null || name.IndexOf("Vynel Call", StringComparison.OrdinalIgnoreCase) < 0) continue;
            object activated;
            if (device.Activate(ref volumeIid, 23, IntPtr.Zero, out activated) != 0) continue;
            var volume = (IAudioEndpointVolume)activated;
            float before; bool muted;
            volume.GetMasterVolumeLevelScalar(out before);
            volume.GetMute(out muted);
            volume.SetMasterVolumeLevelScalar(1.0f, ref context);
            volume.SetMute(false, ref context);
            float after;
            volume.GetMasterVolumeLevelScalar(out after);
            report.AppendFormat(
                "{{\"name\":\"{0}\",\"beforePercent\":{1},\"afterPercent\":{2},\"wasMuted\":{3}}}\n",
                name.Replace("\"", "'"), Math.Round(before * 100), Math.Round(after * 100), muted ? "true" : "false");
        }
        return report.ToString();
    }
}
}
"@
[VynelMicLevel.Restore]::Run()
`

const ENCODED_RESTORE_SCRIPT = Buffer.from(RESTORE_SCRIPT, 'utf16le').toString('base64')
