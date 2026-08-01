// Test-only helpers, exported as `@vynel/registry/testing` (the
// `@vynel/cloud-db/testing` precedent). Since `publishCatalogArtifact`
// inspects every artifact, tests can no longer publish arbitrary buffers —
// this is the one home for "a tiny REAL zip with known contents".

import JSZip from 'jszip'

/** Build a real zip artifact from a name→content map. Different contents
 *  produce different bytes (and shas), which byte-immutability tests rely
 *  on. */
export function zipArtifact(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
