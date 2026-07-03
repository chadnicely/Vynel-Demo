import { describe, it, expect } from 'vitest'
import { buildSnapshotAppResponse } from './snapshot-app-tool.js'

describe('buildSnapshotAppResponse', () => {
  it('labels the tree with the queried app and includes the dump', () => {
    const text =
      buildSnapshotAppResponse('Calculator', 'window "Calculator"\n  button "Five"').content[0]?.text ?? ''
    expect(text).toContain('Accessibility tree for "Calculator"')
    expect(text).toContain('button "Five"')
  })

  it('shows a placeholder when the app exposed no tree', () => {
    const text = buildSnapshotAppResponse('Empty', '   ').content[0]?.text ?? ''
    expect(text).toContain('no accessibility tree')
  })
})
