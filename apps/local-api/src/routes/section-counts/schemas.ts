// Zod response schema for the `section-counts` HTTP surface. API-internal —
// two consumers (the user- and workspace-scoped twins), per
// `coding-standard.md` "Zod schemas".

import { z } from 'zod'

// Only the sections with an honest, cheap count appear. A section absent
// here renders NO number in the menu (the canvas does the same for Memory /
// Knowledge / Settings) — a fabricated zero would read as "empty".
export const SectionCountsResponseSchema = z.object({
  counts: z.object({
    sessions: z.number().int(),
    agents: z.number().int(),
    skills: z.number().int(),
    rules: z.number().int(),
    commands: z.number().int(),
    /** Workspace-only — Apps needs a running project, so it has no global row. */
    apps: z.number().int().optional(),
  }),
})
