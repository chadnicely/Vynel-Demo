// `readHostOsEnvVar` — the carved-out helper for reading host-OS environment
// variables (runtime credential / OS-state discovery).
//
// Vynel's general rule is "no process.env outside env.ts" (Zod-validated app
// config). This helper is the explicit, documented carve-out for INSPECTING
// host-OS state — fundamentally different from Vynel's own config. Use ONLY
// inside `packages/providers/src/<providerId>/internal/`; the code-reviewer
// enforces this single carve-out point. See `decisions.md D14` +
// `docs/blueprints/providers/blueprint.md §11.1`.

export function readHostOsEnvVar(name: string): string | null {
  const value = process.env[name]
  return value !== undefined && value.trim().length > 0 ? value : null
}
