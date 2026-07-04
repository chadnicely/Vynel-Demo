import { describe, it, expect } from 'vitest'
import { summarizeTurnForVoice } from './summarize-turn-for-voice.js'
import type { NormalizedSessionEvent } from '@vynel/providers'

function textChunk(textDelta: string): NormalizedSessionEvent {
  return { kind: 'text-chunk', sessionId: 's', messageId: 'm', textDelta, isFinalChunk: false }
}
const completed: NormalizedSessionEvent = {
  kind: 'session-completed',
  sessionId: 's',
  isNewSession: true,
  completedAt: new Date(0),
}

describe('summarizeTurnForVoice', () => {
  it('speaks "<label> is done." with the first-sentence gist on a completed turn', () => {
    const summary = summarizeTurnForVoice('the landing page', [
      textChunk('I built the landing page with a hero and a contact form. '),
      textChunk('It is responsive.'),
      completed,
    ])
    expect(summary.outcome).toBe('completed')
    expect(summary.spokenText).toBe(
      'the landing page is done. I built the landing page with a hero and a contact form.',
    )
  })

  it('falls back to a clean line when the turn produced no text (empty-result case)', () => {
    const summary = summarizeTurnForVoice('the export', [completed])
    expect(summary).toEqual({ outcome: 'completed', spokenText: 'the export is done.' })
  })

  it('strips markdown so fences, headings, and links are never read aloud', () => {
    const summary = summarizeTurnForVoice('the summary', [
      textChunk('## Heading\nSee [the doc](https://x.y) for `code`.'),
      completed,
    ])
    expect(summary.spokenText).not.toContain('#')
    expect(summary.spokenText).not.toContain('https://')
    expect(summary.spokenText).toContain('See the doc for code.')
  })

  it('does not leak autolinks, reference links, HTML tags, table pipes, or list markers', () => {
    const spoken = (text: string) =>
      summarizeTurnForVoice('x', [textChunk(text), completed]).spokenText
    expect(spoken('Done <https://example.com> ok.')).not.toContain('https://')
    expect(spoken('Done <https://example.com> ok.')).not.toContain('<')
    expect(spoken('See [the doc][1] now.')).not.toContain('[')
    expect(spoken('Click <button>here</button> now.')).not.toContain('<button>')
    expect(spoken('| col a | col b | done.')).not.toContain('|')
    // A numbered list keeps its content — it is NOT reduced to "1.".
    const listed = spoken('1. Ship the feature.')
    expect(listed).toContain('Ship the feature.')
    expect(listed).not.toMatch(/\bis done\.\s*1\.\s*$/)
  })

  it('reports a failure with the first sentence of the error', () => {
    const summary = summarizeTurnForVoice('the deploy', [
      textChunk('trying...'),
      {
        kind: 'session-errored',
        sessionId: 's',
        errorCode: 'x',
        errorMessage: 'The build failed. Check the logs.',
        isRecoverable: false,
        erroredAt: new Date(0),
      },
    ])
    expect(summary.outcome).toBe('failed')
    expect(summary.spokenText).toBe('the deploy ran into a problem: The build failed.')
  })

  it('reports an interruption', () => {
    const summary = summarizeTurnForVoice('the research', [
      textChunk('looking...'),
      { kind: 'session-interrupted', sessionId: 's', interruptedAt: new Date(0) },
    ])
    expect(summary).toEqual({
      outcome: 'interrupted',
      spokenText: 'the research was interrupted before it finished.',
    })
  })

  it('truncates a very long single sentence with an ellipsis', () => {
    const summary = summarizeTurnForVoice('the thing', ['x'.repeat(400)].map(textChunk).concat([completed]))
    expect(summary.spokenText.length).toBeLessThan(280)
    expect(summary.spokenText.endsWith('…')).toBe(true)
  })
})
