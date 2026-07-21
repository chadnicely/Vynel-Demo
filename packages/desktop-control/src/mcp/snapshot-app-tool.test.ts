import { describe, it, expect } from 'vitest'
import { buildSnapshotAppResponse } from './snapshot-app-tool.js'
import type { AppSnapshot } from '../a11y/xa11y-adapter.js'

function snapshot(tree: string, overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return { tree, wakeIncomplete: false, focusSucceeded: null, ...overrides }
}

describe('buildSnapshotAppResponse', () => {
  it('labels the tree with the queried app and includes the dump', () => {
    const text =
      buildSnapshotAppResponse('Calculator', snapshot('window "Calculator"\n  button "Five"'))
        .content[0]?.text ?? ''
    expect(text).toContain('Accessibility tree for "Calculator"')
    expect(text).toContain('button "Five"')
  })

  it('shows a placeholder when the app exposed no tree', () => {
    const text = buildSnapshotAppResponse('Empty', snapshot('   ')).content[0]?.text ?? ''
    expect(text).toContain('no accessibility tree')
  })

  it('an empty tree after a focus-refused wake tells the user to click the window', () => {
    const text =
      buildSnapshotAppResponse(
        'Discord',
        snapshot('', { wakeIncomplete: true, focusSucceeded: false }),
      ).content[0]?.text ?? ''
    expect(text).toContain('refused focus')
    expect(text).toContain('"Discord"')
  })

  it('an empty tree after an incomplete wake (focus ok) suggests a retry', () => {
    const text =
      buildSnapshotAppResponse('Slack', snapshot('', { wakeIncomplete: true, focusSucceeded: true }))
        .content[0]?.text ?? ''
    expect(text).toContain('Retry in a few seconds')
  })

  it('a non-empty but incomplete tree carries the may-not-be-fully-loaded caveat', () => {
    const text =
      buildSnapshotAppResponse(
        'Discord',
        snapshot('window "Discord"\n  document "x"', { wakeIncomplete: true, focusSucceeded: true }),
      ).content[0]?.text ?? ''
    expect(text).toContain('document "x"')
    expect(text).toContain('may not be fully loaded')
  })
})
