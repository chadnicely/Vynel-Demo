// The duty-book binding — kind → notebook, resolved, never hardcoded at a call
// site (docs/module-notes/session-continuity.md §4.5). Every session KIND has
// a duty book that teaches it its duty (Kafi's `.notes/` drafts become these
// books when they are ready). The BINDING ships before the CONTENT: a missing
// book is a normal state — `exists: false`, no error, no log — so the moment a
// book lands on the shelf every session of that kind starts reading it, with
// zero code change at content time. Reading stays on demand through the
// notebook tools (never prompt-injected — the locked notebook model).
//
// "On the shelf" = the VERIFIED shelf (`packages/instructions/notebooks/`):
// duty books are team-curated by definition, and only that shelf carries
// kebab-case ids a binding can name (user notebook documents are UUID-keyed).

// The verified shelf's own light subpath (fs only) — the barrel would drag the
// notebook MCP builder (and the SDK) onto session's module-load path.
import { findVerifiedNotebookById } from '@vynel/instructions/verified-notebooks'
import type { PrimarySessionScope } from '../repositories/index.js'

/** A continuing identity's scope, or `plain` — a conversation with no
 *  continuing identity (a workspace session opened by id / started fresh). */
export type DutyBookKind = PrimarySessionScope | 'plain'

// Notebook ids are kebab-case (the shelf's frontmatter contract) — no slashes.
// The voice thread is the global root's spoken twin and reads its book.
export const DUTY_BOOK_SLUGS: Readonly<Record<DutyBookKind, string>> = {
  global: 'duty-global-root',
  voice: 'duty-global-root',
  workspace: 'duty-workspace-manager',
  spawned: 'duty-spawned-session',
  agent: 'duty-agent-colleague',
  plain: 'duty-workspace-session',
}

export function resolveDutyBookSlug(kind: DutyBookKind): string {
  return DUTY_BOOK_SLUGS[kind]
}

export type DutyBook = {
  slug: string
  /** Whether a verified book with that id is on the shelf yet. */
  exists: boolean
}

export function resolveDutyBook(
  kind: DutyBookKind,
  deps: { bookExists?: (slug: string) => boolean } = {},
): DutyBook {
  const slug = resolveDutyBookSlug(kind)
  const bookExists = deps.bookExists ?? ((id: string) => findVerifiedNotebookById(id) !== null)
  return { slug, exists: bookExists(slug) }
}
