import type { LocalModelKind, LocalModelSpeaker } from './local-model-catalog.js'

// HTTP shapes for the `/models` routes — the Settings screens' read of what is
// on this computer. Catalog facts ride along so the UI never needs the catalog
// module itself (the `server-install` precedent: one wire shape, the route
// types its serializer's return as it, the UI casts SDK responses to it).

export type LocalModelState = 'installed' | 'missing' | 'downloading' | 'failed'

/** The download in flight or the last one's outcome — null when none ran
 *  this process. */
export interface LocalModelDownloadResponse {
  bytes: number
  total: number | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface LocalModelStatusResponse {
  id: string
  kind: LocalModelKind
  label: string
  description: string
  approxBytes: number
  speakers: LocalModelSpeaker[] | null
  state: LocalModelState
  /** From Vynel's own stamp; null for a model fetched another way. */
  installedAt: string | null
  download: LocalModelDownloadResponse | null
}

export interface LocalModelsResponse {
  models: LocalModelStatusResponse[]
}
