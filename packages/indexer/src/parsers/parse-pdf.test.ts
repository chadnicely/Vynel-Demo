// Tests for parsePdfDocument.
//
// PDF fixture tests are skipped pending a binary fixture commit. The
// parser implementation is a thin wrapper around `pdf-parse`; integration
// correctness is verified at /build-domain Step 21 (smoke test against a
// real workspace with a real PDF). The test-discipline rule (.skip with
// a documented reason) applies here:
// "Re-enable once a minimal text-PDF fixture is committed under
//  __fixtures__/sample.pdf (or generated inline via pdfkit at test setup)."
// Tracked as a Foundation-hardening backlog item.

import { describe, it } from 'vitest'

describe('parsePdfDocument', () => {
  // SKIP: requires a binary `__fixtures__/sample.pdf`. Re-enable when
  // the fixture is committed OR when an inline PDF generator is added
  // (Foundation-hardening backlog).
  it.skip('extracts text from a text PDF + returns pageCount', () => {})

  // SKIP: same reason as above.
  it.skip('returns empty parsedText for a scanned PDF (no error)', () => {})
})
