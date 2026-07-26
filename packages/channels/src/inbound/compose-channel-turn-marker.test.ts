import { describe, expect, it } from 'vitest'
import { composeChannelTurnMarker } from './compose-channel-turn-marker.js'

describe('composeChannelTurnMarker', () => {
  it('a DM marker names the channel and the tool, and says text is not delivered', () => {
    const marker = composeChannelTurnMarker({ channelKind: 'telegram', group: null })
    expect(marker).toContain('via TELEGRAM as a direct message')
    expect(marker).toContain('reply_to_channel')
    expect(marker).toContain('NOT delivered')
    expect(marker).not.toContain('thread')
  })

  it('a GROUP marker names who asked, the room, and the threading', () => {
    const marker = composeChannelTurnMarker({
      channelKind: 'telegram',
      group: { senderDescription: 'Alice', title: 'Marketing Team' },
    })
    expect(marker).toContain('from Alice in group "Marketing Team"')
    expect(marker).toContain('thread onto their message')
  })

  it('an untitled group falls back to "a group chat"', () => {
    const marker = composeChannelTurnMarker({
      channelKind: 'telegram',
      group: { senderDescription: 'Alice', title: null },
    })
    expect(marker).toContain('from Alice in a group chat')
  })
})
