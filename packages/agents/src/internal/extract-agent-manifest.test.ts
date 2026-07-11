// Zip-bomb walls of the agent-artifact extractor: the raw-input cap fires
// BEFORE any archive parsing, and the declared-uncompressed-size guard
// fires BEFORE inflating the agent.json entry. Happy-path extraction is
// covered end-to-end by lifecycle/install-cloud-agent.test.ts.

import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { extractAgentManifest } from './extract-agent-manifest.js'

describe('extractAgentManifest', () => {
  it('rejects a raw artifact larger than the 1 MB cap before parsing', async () => {
    // Not a zip at all — proves the size wall fires before loadAsync,
    // otherwise the error would be the "not a valid archive" one.
    const oversized = Buffer.alloc(1024 * 1024 + 1)
    await expect(extractAgentManifest(oversized)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('exceeds the size limit'),
    })
  })

  it('rejects an agent.json whose declared uncompressed size exceeds the per-file cap', async () => {
    const zip = new JSZip()
    // 300 KB > the 256 KB per-file cap, while the archive stays under 1 MB.
    zip.file('agent.json', 'a'.repeat(300 * 1024))
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    expect(bytes.byteLength).toBeLessThan(1024 * 1024)
    await expect(extractAgentManifest(bytes)).rejects.toMatchObject({
      code: 'validation_failed',
      message: expect.stringContaining('agent.json exceeds the size limit'),
    })
  })
})
