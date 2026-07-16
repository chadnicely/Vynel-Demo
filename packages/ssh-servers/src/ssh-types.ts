// Domain-only types for the `ssh-servers` leaf.

// The subset of pino the core logs against (the tasks/asks precedent).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

// What the sealed blob holds, by auth kind. Passphrase-protected keys carry
// their passphrase alongside — sealed together, opened together, only inside
// the exec path.
export type SshCredentials =
  | { authKind: 'password'; password: string }
  | { authKind: 'private-key'; privateKey: string; passphrase?: string }

export interface SshCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  /** Recorded on a first connect so the caller can pin it (TOFU). */
  hostKeyFingerprint: string
}
