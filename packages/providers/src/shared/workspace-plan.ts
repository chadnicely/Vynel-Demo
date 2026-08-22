// The new-workspace wizard's AI seam — two one-shot reads, both best-effort:
//
//   - `RivalSiteStudy`: "Is there one like it already?" — what a named site
//     does, what we would leave out, and what would make yours better. v1 is
//     the model's OWN KNOWLEDGE of the site (toolless, no live read) and the
//     UI labels it as exactly that — no pretend analysis.
//   - `WorkspacePlan`: every wizard answer distilled into the plan the user
//     rates — the one-liner, the build list, the MVP nutshell, the goals and
//     the build sessions. Null = the caller falls back to its own derivation.
//
// The answer + plan shapes are the contract's (`workspace-brief`): the same
// objects the wizard stores on the workspace once the plan is approved.

import type {
  WorkspaceBriefAnswers,
  WorkspacePlan,
} from '@vynel/contracts/workspaces/workspace-brief'
import type { ProviderLogger } from './provider-logger.js'

export type { WorkspacePlan }

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

/** The answers the synthesis reads (the stack screen's advanced notes stay
 *  out of the prompt — they ride the brief instead) + the dispatch cwd. */
export type WorkspacePlanInput = Omit<WorkspaceBriefAnswers, 'advancedNotes'> & {
  /** The dispatch cwd — the folder the user chose as the app's home (its
   *  parent, since the app does not exist yet). Nothing is written there;
   *  its own Claude Code settings / CLAUDE.md load as for any workspace. */
  workspacePath: string
  logger?: ProviderLogger
}
