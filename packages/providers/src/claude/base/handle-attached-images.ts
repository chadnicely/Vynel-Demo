// `handleAttachedImages` — writes attached images AND documents to a per-turn
// temp directory and returns the prompt with `[Image: <path>]` /
// `[Attached file: <path>]` references inlined, plus an async cleanup for the
// turn's temp dir. The Claude Agent SDK takes a string prompt; attachments are
// surfaced to the agent as on-disk file references it reads with its own tools.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatMessageImage } from '../../shared/start-chat-session-input.js'

export type HandleAttachedImagesInput = {
  userMessageText: string
  attachedImages?: ChatMessageImage[]
}

export type ImageHandlingResult = {
  /** The prompt with attachment references inlined (e.g. "[Image: /tmp/...png]"). */
  modifiedPrompt: string
  /** Async cleanup of the temp files written for this turn. */
  cleanup: () => Promise<void>
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
  'application/json': 'json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

// Keep the user's filename when it's plainly safe (the HTTP boundary already
// guards it; this re-check covers non-HTTP callers) — otherwise fall back to a
// generated name. The agent reading "[Attached file: …/report.pdf]" beats a UUID.
function tempFileNameFor(attachment: ChatMessageImage): string {
  const name = attachment.filename
  // `:` would name an NTFS alternate data stream on Windows — confined to the
  // turn dir but still not the file the agent expects to read.
  const isSafe =
    name !== undefined &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes(':') &&
    !name.includes('\0') &&
    name !== '.' &&
    name !== '..'
  if (isSafe) return name
  const extension = EXTENSION_BY_MIME_TYPE[attachment.mimeType] ?? 'bin'
  return `attachment-${randomUUID()}.${extension}`
}

export async function handleAttachedImages(
  input: HandleAttachedImagesInput,
): Promise<ImageHandlingResult> {
  const attachments = input.attachedImages ?? []
  if (attachments.length === 0) {
    return { modifiedPrompt: input.userMessageText, cleanup: () => Promise.resolve() }
  }

  // One directory per turn: original filenames can't collide across turns, and
  // cleanup is a single recursive remove.
  const turnDir = join(tmpdir(), `vynel-attachments-${randomUUID()}`)
  await mkdir(turnDir, { recursive: true })

  const references: string[] = []
  const usedNames = new Set<string>()
  for (const attachment of attachments) {
    let fileName = tempFileNameFor(attachment)
    // Two pasted screenshots both arrive as "image.png" — suffix the repeat.
    while (usedNames.has(fileName)) fileName = `${randomUUID().slice(0, 8)}-${fileName}`
    usedNames.add(fileName)
    const filePath = join(turnDir, fileName)
    await writeFile(filePath, Buffer.from(attachment.base64Data, 'base64'))
    references.push(
      isImageMimeType(attachment.mimeType) ? `[Image: ${filePath}]` : `[Attached file: ${filePath}]`,
    )
  }

  return {
    modifiedPrompt: `${input.userMessageText}\n\n${references.join('\n')}`,
    cleanup: async () => {
      // Best-effort — a missing temp dir is not an error worth surfacing.
      await rm(turnDir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}
