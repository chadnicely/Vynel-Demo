// Type-equality assertion: DocumentKind is declared in TWO places:
//   - packages/db/src/schema/knowledge/documents.ts (the schema's source of truth)
//   - packages/indexer/src/parsers/parser-types.ts (the parser registry's switch)
//
// They cannot trivially share a definition: per decisions.md D24,
// @vynel/indexer must NOT import @vynel/db (pure-helpers package);
// @vynel/db importing @vynel/indexer would invert the dep root.
//
// This file lives in @vynel/knowledge, which already depends
// on BOTH packages — so the type-equality check has a natural home.
// Future drift fails the build instead of silently shipping.
//
// (Pre-existing S3 from /build-domain knowledge code-reviewer Gate 3,
// 2026-05-25.)

import { describe, it, expect } from 'vitest'
import type { DocumentKind as SchemaDocumentKind } from '@vynel/db/schema/knowledge'
import type { DocumentKind as ParserDocumentKind } from '@vynel/indexer'

// If either side drops or adds a member, this conditional type
// short-circuits to `never` and the assignment below fails to compile.
type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const _schemaEqualsParser: AssertEqual<SchemaDocumentKind, ParserDocumentKind> = true
const _parserEqualsSchema: AssertEqual<ParserDocumentKind, SchemaDocumentKind> = true

describe('DocumentKind sync', () => {
  it('schema and parser unions are referentially equivalent (compile-time check)', () => {
    // The `_schemaEqualsParser` / `_parserEqualsSchema` constants above
    // FAIL TO TYPECHECK if the two unions ever drift. The runtime
    // assertion is just a witness so the test runner reports the file
    // as exercised.
    expect(_schemaEqualsParser).toBe(true)
    expect(_parserEqualsSchema).toBe(true)
  })
})
