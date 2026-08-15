/*++

Module Name:

    LoopbackRing.h

Abstract:

    A device-level ring buffer that turns the render endpoint and the capture
    endpoint into a virtual cable: the render stream engine writes the audio an
    app plays into "Vynel Call <n> Voice", and the capture stream engine reads
    it back out as "Vynel Call <n> Microphone" (what the call app selects as
    its mic). One instance lives in the device context, shared by both
    circuits; both ProcessPacket paths run at DISPATCH_LEVEL, so every access
    takes the spin lock.

    Format tolerance: the ring stores CANONICAL MONO 16-bit samples. The
    render side folds each of its frames to one sample on write (integer
    average across channels); the capture side replicates each sample to its
    own channel count on read — so the shipped stereo-Voice/mono-Microphone
    shape carries audio faithfully, as does any other channel pairing. Sample
    RATE is never converted: both circuits advertise 48 kHz ONLY, so a rate
    mismatch cannot occur by construction (Windows' engine converts shared-mode
    app audio to the endpoint format, and exclusive mode can only pick
    advertised formats). Non-16-bit formats are unrepresentable for the same
    reason; the stream engines still guard and park the cable (silence) rather
    than fold garbage.

Environment:

    Kernel mode

--*/

#pragma once

// Relies on the kernel types (KSPIN_LOCK, PBYTE, ULONG) already pulled in by
// the includer via private.h (wdm.h + windef.h) — mirrors the other Common
// headers, which include no kernel umbrella of their own.

// Mono 16-bit at 48 kHz makes this ~2.7 s of slack before the ring drops the
// oldest audio — room for a slow capture drain or a render burst.
#define LOOPBACK_RING_SAMPLES (128 * 1024)

class CLoopbackRing
{
public:
    __drv_maxIRQL(DISPATCH_LEVEL)
    VOID
    Init();

    __drv_maxIRQL(DISPATCH_LEVEL)
    VOID
    Reset();

    // Fold Length bytes of just-played render frames (Channels 16-bit samples
    // per frame, averaged to mono) into the ring. When the ring is full the
    // oldest audio is dropped (a live cable favors the newest sound over a
    // growing delay). A trailing partial frame is ignored.
    __drv_maxIRQL(DISPATCH_LEVEL)
    VOID
    WriteFrames(
        _In_reads_bytes_(Length) PBYTE Source,
        _In_                     ULONG  Length,
        _In_                     ULONG  Channels
        );

    // Fill Length bytes of capture frames (each ring sample replicated across
    // Channels), zero-filling whatever isn't available yet (an underrun reads
    // as silence, never stale audio or garbage).
    __drv_maxIRQL(DISPATCH_LEVEL)
    VOID
    ReadFrames(
        _Out_writes_bytes_all_(Length) PBYTE  Destination,
        _In_                           ULONG  Length,
        _In_                           ULONG  Channels
        );

private:
    KSPIN_LOCK  m_Lock;
    ULONG       m_WritePosition;      // in samples
    ULONG       m_ReadPosition;       // in samples
    ULONG       m_SamplesAvailable;
    SHORT       m_Buffer[LOOPBACK_RING_SAMPLES];
};
