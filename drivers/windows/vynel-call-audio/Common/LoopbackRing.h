/*++

Module Name:

    LoopbackRing.h

Abstract:

    A device-level PCM ring buffer that turns the render endpoint and the
    capture endpoint into a virtual cable: the render stream engine writes the
    audio an app plays into "Vynel Call <n> Voice", and the capture stream
    engine reads it back out as "Vynel Call <n> Microphone" (what the call app
    selects as its mic). One instance lives in the device context, shared by
    both circuits; both ProcessPacket paths run at DISPATCH_LEVEL, so every
    access takes the spin lock.

    Format assumption (v1): both endpoints run the SAME PCM format. Vynel's own
    daemon opens both ends, so it picks matching formats; a mismatch produces
    wrong-rate audio rather than a crash. In-driver resampling is a recorded
    later-improve. See README.md.

Environment:

    Kernel mode

--*/

#pragma once

// Relies on the kernel types (KSPIN_LOCK, PBYTE, ULONG) already pulled in by
// the includer via private.h (wdm.h + windef.h) — mirrors the other Common
// headers, which include no kernel umbrella of their own.

// One second of 48 kHz / stereo / 16-bit is 192 KB; round up so a slow capture
// drain (or a burst) has slack before the ring drops the oldest audio.
#define LOOPBACK_RING_BYTES (256 * 1024)

class CLoopbackRing
{
public:
    __drv_maxIRQL(DISPATCH_LEVEL)
    VOID
    Init();

    __drv_maxIRQL(DISPATCH_LEVEL)
    VOID
    Reset();

    // Copy Length bytes of just-played render audio into the ring. When the
    // ring is full the oldest audio is dropped (a live cable favors the newest
    // sound over a growing delay).
    __drv_maxIRQL(DISPATCH_LEVEL)
    VOID
    Write(
        _In_reads_bytes_(Length) PBYTE Source,
        _In_                     ULONG  Length
        );

    // Fill Length bytes for the capture endpoint from the ring, zero-filling
    // whatever isn't available yet (an underrun reads as silence, never stale
    // audio or garbage).
    __drv_maxIRQL(DISPATCH_LEVEL)
    VOID
    Read(
        _Out_writes_bytes_all_(Length) PBYTE  Destination,
        _In_                           ULONG  Length
        );

private:
    KSPIN_LOCK  m_Lock;
    ULONG       m_WritePosition;
    ULONG       m_ReadPosition;
    ULONG       m_BytesAvailable;
    BYTE        m_Buffer[LOOPBACK_RING_BYTES];
};
