// The ONE way a name a person types becomes a `.claude/` file stem —
// kebab-case keeps it readable in the folder and safe on every filesystem
// (the engine's `isSafeFileStem` is the wall; this is the friendly shape).
// Each kind picks its cap: rules and agent files 80 (the API slug max),
// skill folders 64 (Claude Code skill names).
export function slugifyFileStem(raw: string, maxLength: number): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}
