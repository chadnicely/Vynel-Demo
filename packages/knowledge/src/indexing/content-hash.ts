// Content hashing for the `knowledge` indexer. `sha256` over a document's
// parsed text drives hash-skip — re-index only when the content actually
// changed. Sole consumer: `index-file.ts`.

import { createHash } from 'node:crypto'

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
