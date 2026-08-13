/*++

Module Name:

    LoopbackRing.cpp

Abstract:

    Implementation of the render->capture PCM ring (see LoopbackRing.h).

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
    m_BytesAvailable = 0;
    KeReleaseSpinLock(&m_Lock, oldIrql);
}

_Use_decl_annotations_
VOID
CLoopbackRing::Write(
    PBYTE Source,
    ULONG Length
)
{
    if (Length == 0)
    {
        return;
    }

    KIRQL oldIrql;
    KeAcquireSpinLock(&m_Lock, &oldIrql);

    // A single Write longer than the whole ring can only keep its final
    // LOOPBACK_RING_BYTES — copy just that tail, freshest audio.
    if (Length >= LOOPBACK_RING_BYTES)
    {
        Source += (Length - LOOPBACK_RING_BYTES);
        Length = LOOPBACK_RING_BYTES;
        m_WritePosition = 0;
        m_ReadPosition = 0;
        m_BytesAvailable = 0;
    }

    ULONG firstChunk = min(Length, LOOPBACK_RING_BYTES - m_WritePosition);
    RtlCopyMemory(&m_Buffer[m_WritePosition], Source, firstChunk);
    if (Length > firstChunk)
    {
        RtlCopyMemory(&m_Buffer[0], Source + firstChunk, Length - firstChunk);
    }
    m_WritePosition = (m_WritePosition + Length) % LOOPBACK_RING_BYTES;

    m_BytesAvailable += Length;
    if (m_BytesAvailable > LOOPBACK_RING_BYTES)
    {
        // Overflow: the writer lapped the reader. Drop the oldest audio by
        // pulling the read cursor up to the write cursor's tail.
        ULONG overrun = m_BytesAvailable - LOOPBACK_RING_BYTES;
        m_ReadPosition = (m_ReadPosition + overrun) % LOOPBACK_RING_BYTES;
        m_BytesAvailable = LOOPBACK_RING_BYTES;
    }

    KeReleaseSpinLock(&m_Lock, oldIrql);
}

_Use_decl_annotations_
VOID
CLoopbackRing::Read(
    PBYTE Destination,
    ULONG Length
)
{
    if (Length == 0)
    {
        return;
    }

    KIRQL oldIrql;
    KeAcquireSpinLock(&m_Lock, &oldIrql);

    ULONG toCopy = min(Length, m_BytesAvailable);
    if (toCopy > 0)
    {
        ULONG firstChunk = min(toCopy, LOOPBACK_RING_BYTES - m_ReadPosition);
        RtlCopyMemory(Destination, &m_Buffer[m_ReadPosition], firstChunk);
        if (toCopy > firstChunk)
        {
            RtlCopyMemory(Destination + firstChunk, &m_Buffer[0], toCopy - firstChunk);
        }
        m_ReadPosition = (m_ReadPosition + toCopy) % LOOPBACK_RING_BYTES;
        m_BytesAvailable -= toCopy;
    }

    // Underrun (nothing played, or the reader outpaced the writer) is silence.
    if (toCopy < Length)
    {
        RtlZeroMemory(Destination + toCopy, Length - toCopy);
    }

    KeReleaseSpinLock(&m_Lock, oldIrql);
}
