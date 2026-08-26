// `spawnSync(..., { shell: true })` — which we need on Windows for the `.cmd`
// shims (tsx, pnpm) — hands the argv to the shell as ONE joined string, so
// the shell re-splits it on whitespace. Any argument holding a real path
// therefore has to arrive already quoted: Chad's checkout lives under
// `C:\Users\chad\Development\Claude Code\...`, and unquoted that split at
// "Claude", so `pnpm test` died with `SyntaxError: Invalid or unexpected
// token` while pointing at a path that never existed.
//
// Learned once in `release/build-desktop.ts`; this is that lesson made
// shared so the next `shell: true` site inherits it instead of rediscovering
// it. Whenever you pass a filesystem path through `shell: true`, map it here.

/** Quote one argument for a `shell: true` spawn. Already-quoted and
 *  space-free arguments pass through untouched. */
export function quoteForShell(argument: string): string {
  if (argument.startsWith('"') || !argument.includes(' ')) return argument
  return `"${argument}"`
}

/** `quoteForShell` across a whole argv. */
export function quoteArgsForShell(args: readonly string[]): string[] {
  return args.map(quoteForShell)
}
