// jszip does not expose an entry's DECLARED uncompressed size publicly —
// it sits on the internal `_data` compressed object populated by
// `loadAsync`. Reading it lets an extractor reject a bomb entry BEFORE
// inflating it. The access is defensive (unknown-typed, never `as any`):
// if a jszip upgrade moves the field this returns null and callers fall
// back to the raw-input cap + the post-inflate backstop instead of
// crashing.
//
// Duplicated in @vynel/skills (same WHY) — the shared extractor home is
// deferred to the THIRD consumer (marketplace-kinds module notes).

import type JSZip from 'jszip'

export function readDeclaredUncompressedSize(entry: JSZip.JSZipObject): number | null {
  const internals: unknown = entry
  if (typeof internals !== 'object' || internals === null) return null
  const compressedObject: unknown = (internals as Record<string, unknown>)['_data']
  if (typeof compressedObject !== 'object' || compressedObject === null) return null
  const declared: unknown = (compressedObject as Record<string, unknown>)['uncompressedSize']
  return typeof declared === 'number' && Number.isFinite(declared) ? declared : null
}
