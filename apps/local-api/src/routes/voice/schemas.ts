import { z } from 'zod'

// The `speak` tool's wire contract. `text` is SPOKEN aloud, so it must be plain
// spoken-style prose — the description steers the model; the daemon speaks it
// verbatim. Capped so a runaway paragraph can't monopolise the single voice.
export const SpeakRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'text must not be empty')
    .max(2000, 'text must be at most 2000 characters'),
})

// `spoken: false` is a SUCCESS with a reason — the voice daemon simply wasn't
// reachable, so the caller (the brain) knows to fall back to a text reply rather
// than treating it as a hard error.
export const SpeakResponseSchema = z.object({
  spoken: z.boolean(),
  reason: z.string().optional(),
})

export type SpeakResponse = z.infer<typeof SpeakResponseSchema>
