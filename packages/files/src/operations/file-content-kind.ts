// File content-kind + MIME derivation for the `files` domain. Pure — no fs,
// no db. Maps a path's extension to a render kind (markdown / image / pdf /
// plain-text / unsupported) and the raw-response Content-Type.

import path from 'node:path'
import type { FileContentKind } from '../files-types.js'

// Editable size cap. Larger text files preview-truncated; the editor
// refuses to open them (the user downloads via /raw).
export const MAX_EDITABLE_BYTES = 1 * 1024 * 1024 // 1 MB

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
])
const PDF_EXTENSIONS = new Set(['.pdf'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
// Treat these as binary / unsupported in-app — they need external tools.
const UNSUPPORTED_BINARY_EXTENSIONS = new Set([
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.pptx',
  '.ppt',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.bin',
  '.so',
  '.dylib',
  '.mp3',
  '.mp4',
  '.mov',
  '.wav',
  '.flac',
  '.ogg',
  '.avi',
])

export function deriveFileContentKind(relativePath: string): FileContentKind {
  const ext = path.extname(relativePath).toLowerCase()
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (UNSUPPORTED_BINARY_EXTENSIONS.has(ext)) return 'unsupported'
  // Default — treat unknown extensions as plain-text. The reader op
  // validates UTF-8 decodability and falls back to 'unsupported' if the
  // bytes aren't UTF-8.
  return 'plain-text'
}

// Whether a given file kind is rendered as an in-app text surface.
// Pure heuristic — the reader applies the UTF-8 sanity check.
export function isTextKind(kind: FileContentKind): boolean {
  return kind === 'markdown' || kind === 'plain-text'
}

export function contentTypeForRawResponse(relativePath: string): string {
  const kind = deriveFileContentKind(relativePath)
  const ext = path.extname(relativePath).toLowerCase()
  if (kind === 'pdf') return 'application/pdf'
  if (kind === 'image') {
    switch (ext) {
      case '.png':
        return 'image/png'
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg'
      case '.gif':
        return 'image/gif'
      case '.webp':
        return 'image/webp'
      case '.svg':
        return 'image/svg+xml'
      case '.ico':
        return 'image/x-icon'
      case '.bmp':
        return 'image/bmp'
      default:
        return 'application/octet-stream'
    }
  }
  if (kind === 'markdown') return 'text/markdown; charset=utf-8'
  if (kind === 'plain-text') return 'text/plain; charset=utf-8'
  // Unsupported / unknown — let the browser decide.
  return 'application/octet-stream'
}
