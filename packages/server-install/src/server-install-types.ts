// Shared leaf types. `ServerCredentials` mirrors the ssh-servers shape at the
// boundary (leaves repeat boundary types; they never import each other).

export interface StructuralLogger {
  info(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
  error(context: Record<string, unknown>, message: string): void
}

export type ServerCredentials =
  | { authKind: 'password'; password: string }
  | { authKind: 'private-key'; privateKey: string; passphrase?: string }
