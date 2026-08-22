// `runClaudeWorkspacePlanSynthesis` — the wizard's one synthesis: every answer the
// user gave (idea, audience, the wish list, the leave-outs, their change
// requests) distilled into the plan they rate — the one-liner, the build
// list, the MVP nutshell, the goals, and the build sessions. One toolless
// dispatch, JSON out, null on failure — the wizard falls back to its own
// mechanical derivation so the screen is never empty.

import type { WorkspacePlan, WorkspacePlanInput } from '../../shared/workspace-plan.js'
import { runClaudeDistillTurn } from './run-claude-distill-turn.js'
import { parseDistillJson, readList, readString, readStringList } from './parse-distill-json.js'

// Plan quality is the product — the capable model, not the cheap one.
const SYNTHESIS_MODEL = 'claude-sonnet-5'

function describeAnswers(input: WorkspacePlanInput): string {
  const lines = [
    `Idea, in their words: ${input.idea}`,
    `Who uses it: ${input.audience}`,
    `The one thing someone should do straight away: ${input.firstThing}`,
    `Sign-in: ${input.signIn}`,
    `Where it lives: ${input.where}`,
    `It keeps track of: ${input.remembers.join(', ') || 'whatever people enter'}`,
    `Stack (already decided): ${input.stack.front}, ${input.stack.back}, ${input.stack.database}`,
  ]
  if (input.wants.length > 0) {
    lines.push(
      'Their wish list (KEEP EVERY ONE, with its source):',
      ...input.wants.map((want) => `  - ${want.text} (from: ${want.from})`),
    )
  }
  if (input.leftOut.length > 0) {
    lines.push('Already agreed to leave out:', ...input.leftOut.map((item) => `  - ${item}`))
  }
  if (input.changeRequests.length > 0) {
    lines.push(
      'Changes they asked for after seeing an earlier plan (FOLD EVERY ONE IN):',
      ...input.changeRequests.map((note) => `  - ${note}`),
    )
  }
  if (input.goalNotes.length > 0) {
    lines.push(
      'Notes they sent back on the goals (FOLLOW THEM):',
      ...input.goalNotes.map((note) => `  - ${note}`),
    )
  }
  return lines.join('\n')
}

function buildPrompt(input: WorkspacePlanInput): string {
  return `A non-technical person answered a new-workspace wizard. Turn their answers into the plan they will read and rate. Their answers:

${describeAnswers(input)}

Reply with ONLY a JSON object — no prose, no code fence:

{
  "oneLine": "A website where your customers can book a table.",  // the whole idea in ONE plain line
  "build": [ { "text": "Let people book a table for a date and time", "source": "your answers" } ],
    // 6-12 lines: everything we build. source is exactly "your answers", "you added", or the site it was ticked from (e.g. "opentable.com")
  "remembers": ["Bookings", "People"],   // what it keeps track of, 3-6 short entries
  "leftOut": ["…"],                      // what we deliberately leave out, with the reason in the line
  "mvpNutshell": "…",                    // one warm plain paragraph: what the smallest worth-using version is, that nothing ticked was dropped
  "goals": [ { "title": "Somewhere your people can book", "bullets": ["One screen, start to finish", "Works the same on a phone"] } ],
    // 3-5 goals, each 2-5 concrete bullets a user can picture
  "sessions": [ { "name": "Make the folder", "items": ["Create the project folder", "Set up the first page"], "mvp": true } ]
    // 10-16 build sessions IN ORDER, each 1-3 items; nice-to-haves after the MVP get "mvp": false (2-4 of them)
}

Rules:
- Plain words a non-technical person understands. Warm, direct, never salesy.
- Keep every wish-list entry — in "build" AND reachable in a goal. Nothing ticked may be dropped.
- Honour every change request and goal note.
- Session 1 is always setting the project up in its folder; the last MVP session is always checking it over end to end.
- Never invent features they did not ask for beyond the small glue that makes it whole.`
}

export async function runClaudeWorkspacePlanSynthesis(
  input: WorkspacePlanInput,
): Promise<WorkspacePlan | null> {
  const reply = await runClaudeDistillTurn({
    prompt: buildPrompt(input),
    workspacePath: input.workspacePath,
    model: SYNTHESIS_MODEL,
    failureLogMessage: 'failed to synthesize the workspace plan',
    logger: input.logger,
  })
  const parsed = parseDistillJson(reply)
  if (parsed === null) return null

  const plan: WorkspacePlan = {
    oneLine: readString(parsed, 'oneLine'),
    build: readSourcedList(parsed, 'build'),
    remembers: readStringList(parsed, 'remembers'),
    leftOut: readStringList(parsed, 'leftOut'),
    mvpNutshell: readString(parsed, 'mvpNutshell'),
    goals: readGoals(parsed),
    sessions: readSessions(parsed),
  }
  // A plan without the three load-bearing pieces is not a plan — fall back
  // whole rather than render a screen with holes in it.
  if (plan.oneLine === '' || plan.build.length === 0 || plan.sessions.length === 0) return null
  return plan
}

function readSourcedList(parsed: unknown, key: string): { text: string; source: string }[] {
  return readList(parsed, key)
    .map((entry) => ({ text: readString(entry, 'text'), source: readString(entry, 'source') }))
    .filter((entry) => entry.text.length > 0)
    .map((entry) => ({
      text: entry.text,
      source: entry.source.length > 0 ? entry.source : 'your answers',
    }))
}

function readGoals(parsed: unknown): { title: string; bullets: string[] }[] {
  return readList(parsed, 'goals')
    .map((entry) => ({ title: readString(entry, 'title'), bullets: readStringList(entry, 'bullets') }))
    .filter((entry) => entry.title.length > 0 && entry.bullets.length > 0)
}

function readSessions(parsed: unknown): { name: string; items: string[]; mvp: boolean }[] {
  return readList(parsed, 'sessions')
    .map((entry) => ({
      name: readString(entry, 'name'),
      items: readStringList(entry, 'items'),
      mvp:
        typeof entry === 'object' && entry !== null
          ? (entry as Record<string, unknown>)['mvp'] !== false
          : true,
    }))
    .filter((entry) => entry.name.length > 0 && entry.items.length > 0)
}
