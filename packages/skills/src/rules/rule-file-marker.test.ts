// The provenance marker's parse contract — load-bearing for the
// hand-authored-file guarantee, so its tolerances (CRLF, BOM) and
// rejections (spoofs, junk) are pinned directly.

import { describe, it, expect } from 'vitest'
import { buildRuleFileContent, parseRuleFileMarker } from './rule-file-marker.js'

describe('rule file marker', () => {
  it('round-trips what buildRuleFileContent writes', () => {
    const content = buildRuleFileContent('conventional-commits', '1.2.0', '# Body')
    expect(parseRuleFileMarker(content)).toEqual({
      ruleId: 'conventional-commits',
      version: '1.2.0',
    })
  })

  it('tolerates a CRLF re-save (Windows editor)', () => {
    const content = '<!-- vynel-marketplace-rule: x v1.0.0 -->\r\n\r\nbody'
    expect(parseRuleFileMarker(content)).toEqual({ ruleId: 'x', version: '1.0.0' })
  })

  it('tolerates a leading UTF-8 BOM (Notepad re-save)', () => {
    const content = '﻿<!-- vynel-marketplace-rule: x v1.0.0 -->\nbody'
    expect(parseRuleFileMarker(content)).toEqual({ ruleId: 'x', version: '1.0.0' })
  })

  it('rejects empty files, plain markdown, and near-miss spoofs', () => {
    expect(parseRuleFileMarker('')).toBeNull()
    expect(parseRuleFileMarker('# My own rules\n')).toBeNull()
    // Trailing junk after the closing arrow — not the marker.
    expect(parseRuleFileMarker('<!-- vynel-marketplace-rule: x v1.0.0 --> extra\n')).toBeNull()
    // Marker-ish text NOT on the first line never counts.
    expect(parseRuleFileMarker('# Title\n<!-- vynel-marketplace-rule: x v1.0.0 -->\n')).toBeNull()
  })
})
