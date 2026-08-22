// `runClaudeRivalSiteStudy` — the wizard's "Is there one like it already?"
// screen. One toolless dispatch: the model lists what the NAMED site does,
// what a focused version would leave out, and what would make the user's
// version better. This is the model's own knowledge of the site — no live
// read — and the UI says so in as many words (the honesty line the whole
// screen stands on). Null on any failure; the screen reports it plainly.

import type { RivalSiteStudy, RivalSiteStudyInput } from '../../shared/workspace-plan.js'
import { runClaudeDistillTurn } from './run-claude-distill-turn.js'
import { parseDistillJson, readList, readString, readStringList } from './parse-distill-json.js'

// Plan quality is the product here — the capable model, not the cheap one
// (deliberate contrast with the report reply's haiku).
const STUDY_MODEL = 'claude-sonnet-5'

function buildPrompt(input: RivalSiteStudyInput): string {
  return `You know the website "${input.site}". A non-technical person wants to build their own, smaller thing: "${input.idea}".

From your own knowledge of ${input.site} (do NOT pretend to have visited it now), reply with ONLY a JSON object — no prose, no code fence:

{
  "whatTheyDo": ["…"],   // 25 to 35 things the site does, one short plain-English line each, the everyday things first ("A search box at the top of every page", "Email confirmation the moment you finish")
  "leaveOut": ["…"],     // 3 to 5 of those things a small focused version should deliberately skip, each with the reason in the line ("The sales pitch — your people already know who you are")
  "magic": [             // exactly 4 ideas that would make the user's version BETTER than the site, for their idea specifically
    { "title": "Done in one screen", "why": "Everything on a single page — pick, confirm, finished." }
  ]
}

Rules:
- Plain words a non-technical person understands. No jargon, no feature-speak.
- Every line is something a user can picture, not a category.
- If you genuinely do not know the site, describe what sites of its kind invariably do — never invent specifics.`
}

export async function runClaudeRivalSiteStudy(
  input: RivalSiteStudyInput,
): Promise<RivalSiteStudy | null> {
  const reply = await runClaudeDistillTurn({
    prompt: buildPrompt(input),
    workspacePath: input.workspacePath,
    model: STUDY_MODEL,
    failureLogMessage: 'failed to study the rival site',
    logger: input.logger,
  })
  const parsed = parseDistillJson(reply)
  if (parsed === null) return null

  const whatTheyDo = readStringList(parsed, 'whatTheyDo')
  const leaveOut = readStringList(parsed, 'leaveOut')
  const magic = readMagic(parsed)
  // A study with no feature list is no study — the screen falls back to its
  // "we could not read it" line rather than a half-empty pretence.
  if (whatTheyDo.length === 0) return null
  return { whatTheyDo, leaveOut, magic }
}

function readMagic(parsed: unknown): { title: string; why: string }[] {
  return readList(parsed, 'magic')
    .map((entry) => ({ title: readString(entry, 'title'), why: readString(entry, 'why') }))
    .filter((entry) => entry.title.length > 0 && entry.why.length > 0)
}
