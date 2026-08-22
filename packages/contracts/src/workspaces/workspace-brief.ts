// The workspace brief — what the new-workspace wizard keeps once the user
// approves the plan (Kafi, 2026-08-23: the plan lives in the DB, never in a
// file in the folder). One row per workspace: the answers the user gave, the
// plan they approved, and the brief text seeded into the composer as the
// first message of the workspace's primary session. The shapes live here
// because three packages read them — `@vynel/providers` (the synthesis
// writes a `WorkspacePlan`), `@vynel/workspaces` (stores + reads the row) and
// the api/web (validate + render). `buildWorkspaceBrief` is the one home for
// the brief text.

export type WorkspaceStack = { front: string; back: string; database: string }

export type WorkspaceBriefAnswers = {
  idea: string
  /** "Just me" / "My team" / "My customers" / "Anyone on the internet". */
  audience: string
  /** The one thing someone should be able to do straight away. */
  firstThing: string
  /** "No, open to everyone" / "Yes, their own account" / "One shared password". */
  signIn: string
  /** "A website" / "A phone app" / "Both". */
  where: string
  /** What it keeps track of — "Bookings", "People", … */
  remembers: string[]
  /** Everything ticked or typed on the wish list, with where it came from. */
  wants: { text: string; from: string }[]
  /** The leave-outs collected from the site studies. */
  leftOut: string[]
  /** "What would make it a 10" notes from the plan-rating loop, oldest first. */
  changeRequests: string[]
  /** "Not quite" notes from the MVP screen, oldest first. */
  goalNotes: string[]
  stack: WorkspaceStack
  /** Free text from the stack screen's advanced settings — "pnpm, strict TypeScript". */
  advancedNotes?: string
}

export type WorkspacePlan = {
  /** The whole idea in one line — the plan screen's callout. */
  oneLine: string
  /** What we build, each line tagged with where it came from. */
  build: { text: string; source: string }[]
  /** What it keeps track of. */
  remembers: string[]
  /** What we are deliberately leaving out. */
  leftOut: string[]
  /** The MVP in a nutshell — one plain paragraph. */
  mvpNutshell: string
  /** The MVP as goals, each a short title over concrete bullets. */
  goals: { title: string; bullets: string[] }[]
  /** The build broken into sessions, in order; `mvp: false` = after the MVP. */
  sessions: { name: string; items: string[]; mvp: boolean }[]
}

/** The stored brief as the api returns it (`GET /workspaces/:id/brief`, the
 *  scaffold response). */
export interface WorkspaceBriefResponse {
  workspaceId: string
  answers: WorkspaceBriefAnswers
  plan: WorkspacePlan
  brief: string
  createdAt: string
}

/**
 * The brief the user sends as the first message of the new workspace — the
 * whole approved plan in one message. The USER presses send; building never
 * starts as a wizard side effect. Session 1's items are listed as the first
 * working steps so the session's rail starts from the approved plan. `note`
 * carries anything the scaffold could not do (git unavailable), so the
 * session knows to pick it up.
 */
export function buildWorkspaceBrief(input: {
  name: string
  answers: WorkspaceBriefAnswers
  plan: WorkspacePlan
  note: string | null
}): string {
  const { name, answers, plan } = input
  const { stack } = answers
  const mvp = plan.sessions.filter((session) => session.mvp)
  const later = plan.sessions.filter((session) => !session.mvp)

  const lines: string[] = [
    `Build ${name} — the MVP first.`,
    '',
    `The idea: ${plan.oneLine}`,
    `Stack: ${stack.front}, ${stack.back}, ${stack.database} (already in the README).`,
  ]
  const advancedNotes = answers.advancedNotes?.trim() ?? ''
  if (advancedNotes.length > 0) lines.push(`Also follow: ${advancedNotes}`)

  lines.push('', 'The MVP, goal by goal:')
  plan.goals.forEach((goal, index) => {
    lines.push(`${index + 1}. ${goal.title} — ${goal.bullets.join('; ')}`)
  })

  lines.push(
    '',
    'I approved this plan of build sessions — work through them IN ORDER, one at a time, and show me each one before moving on:',
  )
  mvp.forEach((session, index) => {
    lines.push(`${index + 1}. ${session.name}: ${session.items.join('; ')}`)
  })
  if (later.length > 0) {
    lines.push(
      '',
      `After the MVP (do not start these yet): ${later.map((session) => session.name).join(' · ')}`,
    )
  }

  const asked = answers.changeRequests.concat(answers.goalNotes)
  if (asked.length > 0) {
    lines.push('', 'Things I asked for along the way — honour them:')
    asked.forEach((note) => lines.push(`- ${note}`))
  }

  lines.push(
    '',
    "Start by laying out session 1's items as your working steps, then begin with the first one.",
  )
  if (input.note !== null) lines.push('', `(Note: ${input.note})`)
  return lines.join('\n')
}
