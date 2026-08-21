import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'

export interface DownloadProgress {
  readonly bytes: number
  /** From Content-Length; null when the server does not say. */
  readonly total: number | null
}

export interface DownloadToFileOptions {
  readonly onProgress?: (progress: DownloadProgress) => void
  readonly signal?: AbortSignal
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch
}

/** The in-flight name: the final path only ever holds a complete file. */
export function partialPathFor(destinationPath: string): string {
  return `${destinationPath}.part`
}

// Stream a URL to disk, counting bytes as they land so a long fetch can show
// where it is. The bytes go to `<destination>.part` and are renamed into place
// only once the stream ended cleanly — so a process killed mid-download (the
// app quit) can never leave a full-named truncated file that a probe counts as
// installed and a native loader chokes on. A failed stream removes its part.
export async function downloadToFile(
  url: string,
  destinationPath: string,
  options: DownloadToFileOptions = {},
): Promise<void> {
  const fetchImpl = options.fetch ?? fetch
  const response = await fetchImpl(url, options.signal ? { signal: options.signal } : {})
  if (!response.ok || response.body === null) {
    throw new Error(`download failed (${response.status} ${response.statusText}) for ${url}`)
  }
  const contentLength = response.headers.get('content-length')
  const total = contentLength !== null && /^\d+$/.test(contentLength) ? Number(contentLength) : null

  let bytes = 0
  const count = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      options.onProgress?.({ bytes, total })
      callback(null, chunk)
    },
  })

  const partialPath = partialPathFor(destinationPath)
  await mkdir(dirname(destinationPath), { recursive: true })
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream),
      count,
      createWriteStream(partialPath),
      options.signal ? { signal: options.signal } : {},
    )
    await rename(partialPath, destinationPath)
  } catch (error) {
    await rm(partialPath, { force: true })
    throw error
  }
}
