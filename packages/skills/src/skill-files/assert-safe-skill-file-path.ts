// The path wall for a file INSIDE a skill folder — a path a person or
// Claude typed: relative, forward slashes, every segment a safe file stem
// (the one predicate the rules and commands doors use — no `..`, no dot
// names, no control bytes, no Windows-reserved characters), a depth cap,
// and never a case-variant of SKILL.md (on Windows/macOS `skill.md` IS the
// entry file, and the entry file has its own rules).

import { ValidationError } from '@vynel/errors'
import { isSafeFileStem } from '@vynel/contracts/fs/safe-file-stem'

export const SKILL_ENTRY_FILE = 'SKILL.md'
export const MAX_SKILL_FILE_PATH_LENGTH = 240
export const MAX_SKILL_FILE_DEPTH = 6

export function assertSafeSkillFilePath(relativePath: string): void {
  if (relativePath.length === 0 || relativePath.length > MAX_SKILL_FILE_PATH_LENGTH) {
    throw new ValidationError('A skill file path must be 1–240 characters.')
  }
  if (relativePath.includes('\\')) {
    throw new ValidationError(`The skill file path '${relativePath}' must use forward slashes.`)
  }
  const segments = relativePath.split('/')
  if (segments.length > MAX_SKILL_FILE_DEPTH) {
    throw new ValidationError(`The skill file path '${relativePath}' nests too deep.`)
  }
  for (const segment of segments) {
    if (!isSafeFileStem(segment)) {
      throw new ValidationError(
        `The skill file path '${relativePath}' has an unsafe part '${segment}' — plain names ` +
          'only (no "..", no leading dot, none of < > : " | ? *).',
      )
    }
  }
  if (
    relativePath.toLowerCase() === SKILL_ENTRY_FILE.toLowerCase() &&
    relativePath !== SKILL_ENTRY_FILE
  ) {
    throw new ValidationError(`The entry file is spelled '${SKILL_ENTRY_FILE}'.`)
  }
}

export function isSkillEntryFile(relativePath: string): boolean {
  return relativePath === SKILL_ENTRY_FILE
}
