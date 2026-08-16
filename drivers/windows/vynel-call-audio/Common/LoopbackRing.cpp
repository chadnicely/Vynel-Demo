/*++

Module Name:

    LoopbackRing.cpp

Abstract:

    Implementation of the render->capture mono ring with per-reader cursors
    (see LoopbackRing.h).

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
    m_TotalWritten = 0;
}

_Use_decl_annotations_
ULONGLONG
CLoopbackRing::CurrentWritePosition()
{
    KIRQL oldIrql;
    KeAcquireSpinLock(&m_Lock, &oldIrql);
    ULONGLONG position = m_TotalWritten;
    KeReleaseSpinLock(&m_Lock, oldIrql);
    return position;
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

    for (ULONG frame = 0; frame < frames; frame++)
    {
        LONG sum = 0;
        for (ULONG channel = 0; channel < Channels; channel++)
        {
            sum += samples[(ULONG_PTR)frame * Channels + channel];
        }
        m_Buffer[m_TotalWritten % LOOPBACK_RING_SAMPLES] = (SHORT)(sum / (LONG)Channels);
        m_TotalWritten++;
    }

    KeReleaseSpinLock(&m_Lock, oldIrql);
}

_Use_decl_annotations_
ULONG
CLoopbackRing::ReadFrames(
    PULONGLONG Position,
    PBYTE Destination,
    ULONG Length,
    ULONG Channels
)
{
    if (Length == 0)
    {
        return 0;
    }

    if (Channels == 0)
    {
        RtlZeroMemory(Destination, Length);
        return 0;
    }

    ULONG frames = Length / (Channels * sizeof(SHORT));
    SHORT* out = (SHORT*)Destination;

    KIRQL oldIrql;
    KeAcquireSpinLock(&m_Lock, &oldIrql);

    // A cursor that fell a whole ring behind points at overwritten audio —
    // snap it to the oldest sample still held (dropping the un-caught-up span
    // is the live-cable trade: newest sound over a growing delay).
    ULONGLONG oldest =
        m_TotalWritten > LOOPBACK_RING_SAMPLES ? m_TotalWritten - LOOPBACK_RING_SAMPLES : 0;
    if (*Position < oldest)
    {
        *Position = oldest;
    }

    ULONGLONG available = m_TotalWritten - *Position;
    ULONG toCopy = (ULONG)min((ULONGLONG)frames, available);
    for (ULONG frame = 0; frame < toCopy; frame++)
    {
        SHORT sample = m_Buffer[*Position % LOOPBACK_RING_SAMPLES];
        (*Position)++;
        for (ULONG channel = 0; channel < Channels; channel++)
        {
            out[(ULONG_PTR)frame * Channels + channel] = sample;
        }
    }

    KeReleaseSpinLock(&m_Lock, oldIrql);

    // Underrun (nothing played, or this reader outpaced the writer) is
    // silence — as is any trailing partial frame.
    ULONG written = toCopy * Channels * sizeof(SHORT);
    if (written < Length)
    {
        RtlZeroMemory(Destination + written, Length - written);
    }
    return toCopy;
}
