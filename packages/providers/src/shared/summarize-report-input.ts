// Input for `AiAgentProvider.summarizeReport` — distills a workspace
// manager's FULL delegation report into the short reply the user actually
// reads: the global chat shows this summary (the full report stays one
// Watch-click away on the delegation trace), and a channel-originated task
// gets it formatted for that channel. Sibling of `SummarizeSessionInput`
// (the same one-shot ephemeral distill discipline), minus the resume — this
// distills provided TEXT, not a session.

import type { ProviderLogger } from './provider-logger.js'

/** Where the reply will be shown — drives the format instructions. */
export type ReportDeliveryTarget = 'chat' | 'telegram' | 'discord'

export type SummarizeReportInput = {
  /** The delegated workspace's folder — the dispatch cwd. */
  workspacePath: string

  /** The task the workspace was asked to do (context for the distill). */
  taskText: string

  /** The workspace manager's full report — the text being distilled. */
  reportText: string

  /** The workspace's display name (the reply speaks as its manager). */
  workspaceName: string

  /** Where the reply lands — 'chat' (the global thread) or a channel kind. */
  deliveryTarget: ReportDeliveryTarget

  /**
   * The model to distill with. Omit for the provider's cheap default (a
   * short, mechanical read-and-distill — never the user's turn model).
   */
  model?: string

  /** Optional structural logger (a failed distill is logged, not thrown). */
  logger?: ProviderLogger
}
