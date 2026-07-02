// `handleAttachedImages` — writes attached images to temp files and returns
// the prompt with `[Image: <path>]` references inlined, plus an async cleanup
// for the turn's temp files. The Claude Agent SDK takes a string prompt;
// images are surfaced to the agent as on-disk file references.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatMessageImage } from '../../shared/start-chat-session-input.js'

export type HandleAttachedImagesInput = {
  userMessageText: string
  attachedImages?: ChatMessageImage[]
  workspacePath: string
}

export type ImageHandlingResult = {
  /** The prompt with image references inlined (e.g. "[Image: /tmp/...png]"). */
  modifiedPrompt: string
  /** Async cleanup of the temp files written for this turn. */
  cleanup: () => Promise<void>
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export async function handleAttachedImages(
  input: HandleAttachedImagesInput,
): Promise<ImageHandlingResult> {
  const images = input.attachedImages ?? []
  if (images.length === 0) {
    return { modifiedPrompt: input.userMessageText, cleanup: () => Promise.resolve() }
  }

  const writtenPaths: string[] = []
  for (const image of images) {
    const extension = EXTENSION_BY_MIME_TYPE[image.mimeType] ?? 'bin'
    const filePath = join(tmpdir(), `vynel-image-${randomUUID()}.${extension}`)
    await writeFile(filePath, Buffer.from(image.base64Data, 'base64'))
    writtenPaths.push(filePath)
  }

  const imageReferences = writtenPaths.map((filePath) => `[Image: ${filePath}]`).join('\n')

  return {
    modifiedPrompt: `${input.userMessageText}\n\n${imageReferences}`,
    cleanup: async () => {
      // Best-effort — a missing temp file is not an error worth surfacing.
      await Promise.all(writtenPaths.map((filePath) => unlink(filePath).catch(() => undefined)))
    },
  }
}
