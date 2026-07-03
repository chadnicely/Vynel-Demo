// Disk persistence for chat message image attachments. Bytes live under
// `<workspace>/.vynel/transcripts/<sessionId>/images/<filename>` — chat owns
// this layout convention (D22). Written on send once the SDK assigns the real
// session id (consume-session-event-stream's session-started handler), and read
// back by the image-serve route for re-display when a conversation is reopened.
//
// Replaces the former `load-attached-images.ts` (which read+base64-encoded for
// the provider). Images now reach the provider inline as base64 in the turn
// request (chat-streaming-ux attachments work), so the disk copy is purely for
// Vynel's own re-display.
//
// PATH-TRAVERSAL DEFENSE (carried over from Gate 3 C2, 2026-05-23): reject
// filenames with path separators / `..` segments / null bytes, then resolve()
// and assert the path stays inside the images directory. The Zod schema at the
// HTTP boundary rejects these too; this guards every non-HTTP caller.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { NotFoundError, ValidationError } from '@vynel/errors'

export type AttachedImageBytes = {
  filename: string
  mimeType: string
  base64Data: string
}

export function imagesDirFor(workspacePath: string, sessionId: string): string {
  return join(workspacePath, '.vynel', 'transcripts', sessionId, 'images')
}

export type PersistAttachedImagesInput = {
  workspacePath: string
  sessionId: string
  images: AttachedImageBytes[]
}

export async function persistAttachedImages(input: PersistAttachedImagesInput): Promise<void> {
  const dir = imagesDirFor(input.workspacePath, input.sessionId)
  await mkdir(dir, { recursive: true })
  await Promise.all(
    input.images.map(async (image) => {
      const target = safeResolve(dir, image.filename)
      await writeFile(target, Buffer.from(image.base64Data, 'base64'))
    }),
  )
}

export type ReadAttachedImageInput = {
  workspacePath: string
  sessionId: string
  filename: string
}

export async function readAttachedImageBytes(input: ReadAttachedImageInput): Promise<Buffer> {
  const dir = imagesDirFor(input.workspacePath, input.sessionId)
  const target = safeResolve(dir, input.filename)
  try {
    return await readFile(target)
  } catch (err) {
    // Translate a missing file to a typed 404 (core translates; the route stays
    // dumb). Other fs errors bubble as-is.
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('image', input.filename)
    }
    throw err
  }
}

function safeResolve(dir: string, filename: string): string {
  assertSafeImageFilename(filename)
  const resolved = resolve(dir, filename)
  const dirWithSep = dir.endsWith(sep) ? dir : dir + sep
  // Defense in depth: after resolve(), the path must still be inside dir.
  if (!resolved.startsWith(dirWithSep)) {
    throw new ValidationError(
      `Invalid image filename: '${filename}'. Path resolves outside the images directory.`,
    )
  }
  return resolved
}

export function assertSafeImageFilename(filename: string): void {
  if (
    filename.length === 0 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    filename === '.' ||
    filename === '..' ||
    filename.split(/[/\\]/).some((segment) => segment === '..')
  ) {
    throw new ValidationError(
      `Invalid image filename: '${filename}'. Filenames must not contain path separators, '..' segments, or null bytes.`,
    )
  }
}
