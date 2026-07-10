// Turns picked/pasted/dropped `File`s into the wire attachments a turn POST
// carries (`attachedImages`: filename + mimeType + base64). Validation happens
// HERE, before the send, so a person gets a plain-words notice instead of a
// server 400: unsupported types and oversized files are rejected by name.

// Mirrors the server allowlist (ATTACHMENT_MIME_TYPES in the chat route
// schemas — route schemas are API-internal in Phase 1, so the list is
// duplicated here by discipline; drift surfaces as a visible 400). The
// generated SDK types `mimeType` as this literal union, so the union is
// derived, not `string`.
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export type TurnAttachmentMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface TurnAttachmentInput {
  filename: string;
  mimeType: TurnAttachmentMimeType;
  base64Data: string;
}

export interface FilesToTurnAttachmentsResult {
  attachments: TurnAttachmentInput[];
  /** Filenames that couldn't ride along, for the composer notice. */
  rejectedNames: string[];
}

const ALLOWED_MIME_TYPE_SET: ReadonlySet<string> = new Set(ALLOWED_MIME_TYPES);

// Browsers report an empty `File.type` for plenty of ordinary files (`.md`
// among them) — fall back to the extension.
const MIME_BY_EXTENSION: Record<string, TurnAttachmentMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// The server caps base64 at 7,000,000 chars (~5.25 MB decoded); reject a hair
// earlier so the person hears it from us, in words, not from a 400.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TURN = 6;

export function resolveAttachmentMimeType(
  file: File,
): TurnAttachmentMimeType | null {
  const reported = file.type.trim().toLowerCase();
  if (ALLOWED_MIME_TYPE_SET.has(reported)) {
    return reported as TurnAttachmentMimeType;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export async function filesToTurnAttachments(
  files: File[],
): Promise<FilesToTurnAttachmentsResult> {
  const attachments: TurnAttachmentInput[] = [];
  const rejectedNames: string[] = [];

  for (const file of files) {
    const mimeType = resolveAttachmentMimeType(file);
    if (
      mimeType === null ||
      file.size > MAX_FILE_SIZE_BYTES ||
      attachments.length >= MAX_ATTACHMENTS_PER_TURN
    ) {
      rejectedNames.push(file.name);
      continue;
    }
    attachments.push({
      filename: file.name,
      mimeType,
      base64Data: await fileToBase64(file),
    });
  }

  return { attachments, rejectedNames };
}
