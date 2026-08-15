/*++

Module Name:

    LoopbackRing.cpp

Abstract:

    Implementation of the render->capture mono ring (see LoopbackRing.h).

Environment:

    Kernel mode

--*/

#include "private.h"
#include "LoopbackRing.h"

_Use_decl_annotations_
VOID
CLoopbackRing::Init()
{
    KeInitializeSpinLock(&m_Lock);
    Reset();
}

_Use_decl_annotations_
VOID
CLoopbackRing::Reset()
{
    KIRQL oldIrql;
    KeAcquireSpinLock(&m_Lock, &oldIrql);
    m_WritePosition = 0;
    m_ReadPosition = 0;
    m_SamplesAvailable = 0;
    KeReleaseSpinLock(&m_Lock, oldIrql);
}

_Use_decl_annotations_
VOID
CLoopbackRing::WriteFrames(
    PBYTE Source,
    ULONG Length,
    ULONG Channels
)
{
    if (Channels == 0)
    {
        return;
    }

    ULONG frames = Length / (Channels * sizeof(SHORT));
    if (frames == 0)
    {
        return;
    }

    const SHORT* samples = (const SHORT*)Source;

    KIRQL oldIrql;
    KeAcquireSpinLock(&m_Lock, &oldIrql);

    // A single write longer than the whole ring can only keep its final
    // LOOPBACK_RING_SAMPLES frames — fold just that tail, freshest audio.
    if (frames >= LOOPBACK_RING_SAMPLES)
    {
        samples += (ULONG_PTR)(frames - LOOPBACK_RING_SAMPLES) * Channels;
        frames = LOOPBACK_RING_SAMPLES;
        m_WritePosition = 0;
        m_ReadPosition = 0;
        m_SamplesAvailable = 0;
    }

    for (ULONG frame = 0; frame < frames; frame++)
    {
        LONG sum = 0;
        for (ULONG channel = 0; channel < Channels; channel++)
        {
            sum += samples[(ULONG_PTR)frame * Channels + channel];
        }
        m_Buffer[m_WritePosition] = (SHORT)(sum / (LONG)Channels);
        m_WritePosition = (m_WritePosition + 1) % LOOPBACK_RING_SAMPLES;
    }

    m_SamplesAvailable += frames;
    if (m_SamplesAvailable > LOOPBACK_RING_SAMPLES)
    {
        // Overflow: the writer lapped the reader. Drop the oldest audio by
        // pulling the read cursor up to the write cursor's tail.
        ULONG overrun = m_SamplesAvailable - LOOPBACK_RING_SAMPLES;
        m_ReadPosition = (m_ReadPosition + overrun) % LOOPBACK_RING_SAMPLES;
        m_SamplesAvailable = LOOPBACK_RING_SAMPLES;
    }

    KeReleaseSpinLock(&m_Lock, oldIrql);
}

_Use_decl_annotations_
VOID
CLoopbackRing::ReadFrames(
    PBYTE Destination,
    ULONG Length,
    ULONG Channels
)
{
    if (Length == 0)
    {
        return;
    }

    if (Channels == 0)
    {
        RtlZeroMemory(Destination, Length);
        return;
    }

    ULONG frames = Length / (Channels * sizeof(SHORT));
    SHORT* out = (SHORT*)Destination;

    KIRQL oldIrql;
    KeAcquireSpinLock(&m_Lock, &oldIrql);

    ULONG toCopy = min(frames, m_SamplesAvailable);
    for (ULONG frame = 0; frame < toCopy; frame++)
    {
        SHORT sample = m_Buffer[m_ReadPosition];
        m_ReadPosition = (m_ReadPosition + 1) % LOOPBACK_RING_SAMPLES;
        for (ULONG channel = 0; channel < Channels; channel++)
        {
            out[(ULONG_PTR)frame * Channels + channel] = sample;
        }
    }
    m_SamplesAvailable -= toCopy;

    KeReleaseSpinLock(&m_Lock, oldIrql);

    // Underrun (nothing played, or the reader outpaced the writer) is
    // silence — as is any trailing partial frame.
    ULONG written = toCopy * Channels * sizeof(SHORT);
    if (written < Length)
    {
        RtlZeroMemory(Destination + written, Length - written);
    }
}
