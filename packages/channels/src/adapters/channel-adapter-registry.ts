// The channel-adapter registry — `resolveChannelAdapter(kind)` returns a
// lazy singleton per kind (`ZoomChannelAdapter` RELIES on this: its
// per-channel sockets live on the instance). `'discord'` throws a clear
// `ValidationError` (Phase 1.5 — D15). Mirrors the providers
// `resolveAiAgentProvider` precedent (one instance per kind for the life
// of the process), but instantiates lazily on first use.
//
// Spec: `docs/blueprints/channels/blueprint.md §5` + `coding.md §2`.

import { ValidationError } from '@vynel/errors'
import { TelegramChannelAdapter } from './telegram/telegram-channel-adapter.js'
import { ZoomChannelAdapter } from './zoom/zoom-channel-adapter.js'
import type { ChannelAdapter } from './channel-adapter.js'
import type { ChannelKind } from '../repositories/index.js'

const adaptersByKind = new Map<ChannelKind, ChannelAdapter>()

export function resolveChannelAdapter(channelKind: ChannelKind): ChannelAdapter {
  const cached = adaptersByKind.get(channelKind)
  if (cached) return cached

  switch (channelKind) {
    case 'telegram': {
      const adapter = new TelegramChannelAdapter()
      adaptersByKind.set(channelKind, adapter)
      return adapter
    }
    case 'zoom': {
      const adapter = new ZoomChannelAdapter()
      adaptersByKind.set(channelKind, adapter)
      return adapter
    }
    case 'discord':
      throw new ValidationError('Discord channels are not supported yet (coming in Phase 1.5).')
    default: {
      const unsupported: never = channelKind
      throw new ValidationError(`Unsupported channel kind: ${String(unsupported)}.`)
    }
  }
}
