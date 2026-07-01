// Tests for parseDocxDocument.
//
// DOCX fixture tests are skipped pending a binary fixture commit. The
// parser implementation is a thin wrapper around `mammoth.extractRawText`;
// integration correctness is verified at /build-domain Step 21 (smoke
// test against a real workspace with a real DOCX). The test-discipline
// rule (.skip with a documented reason) applies here:
// "Re-enable once a minimal `__fixtures__/sample.docx` (zip + minimal
//  XML) is committed."
// Tracked as a Foundation-hardening backlog item.

import { describe, it } from 'vitest'

describe('parseDocxDocument', () => {
  // SKIP: requires a binary `__fixtures__/sample.docx`. Re-enable when
  // the fixture is committed (Foundation-hardening backlog).
  it.skip('extracts text from a .docx file via mammoth', () => {})

  // SKIP: same reason as above.
  it.skip('drops tables / images / headers / footers (text-only)', () => {})
})
