// The new-workspace wizard's AI seam — two one-shot reads, both best-effort:
//
//   - `RivalSiteStudy`: "Is there one like it already?" — what a named site
//     does, what we would leave out, and what would make yours better. v1 is
//     the model's OWN KNOWLEDGE of the site (toolless, no live read) and the
//     UI labels it as exactly that — no pretend analysis.
//   - `WorkspacePlan`: every wizard answer distilled into the plan the user
//     rates — the one-liner, the build list, the MVP nutshell, the goals and
//     the build sessions. Null = the caller falls back to its own derivation.

import type { ProviderLogger } from './provider-logger.js'

export type RivalSiteStudyInput = {
  /** The site as the user typed it — "opentable.com". */
  site: string
  /** The user's idea, so the study is about THEIR angle on the site. */
  idea: string
  /** The dispatch cwd — the folder the user chose as the app's home (its
   *  parent, since the app does not exist yet). Nothing is written there —
   *  the dispatch is toolless — though the folder's own Claude Code settings /
   *  CLAUDE.md load as for any workspace. */
  workspacePath: string
  logger?: ProviderLogger
}

export type RivalSiteStudy = {
  /** What the site does — the tick-list ("A search box at the top…"). */
  whatTheyDo: string[]
  /** What we would deliberately leave out, with the reason in the line. */
  leaveOut: string[]
  /** What would make yours better — bold lead + plain explanation. */
  magic: { title: string; why: string }[]
}

export type WorkspacePlanInput = {
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
  stack: { front: string; back: string; database: string }
  /** The dispatch cwd — the folder the user chose as the app's home (its
   *  parent, since the app does not exist yet). Nothing is written there;
   *  its own Claude Code settings / CLAUDE.md load as for any workspace. */
  workspacePath: string
  logger?: ProviderLogger
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
