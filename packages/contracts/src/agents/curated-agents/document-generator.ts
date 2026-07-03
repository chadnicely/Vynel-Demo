// `document-generator` — a Vynel-curated seed agent. Drafts and edits
// long-form documents (reports, briefs, proposals) from the user's
// notes and source files. Demonstrates a write-capable agent with a
// tight, file-only tool allowlist (no shell, no network) so every
// irreversible action still flows through the normal tool path.

import type { CuratedAgentDefinition } from './curated-agent-definition.js'

export const documentGeneratorAgent: CuratedAgentDefinition = {
  slug: 'document-generator',
  name: 'Document Generator',
  description:
    'Use when the user wants a polished long-form document drafted or revised — a report, ' +
    'brief, proposal, or summary — from their notes, outline, or existing files.',
  iconName: 'file-text',
  prompt: `You are Document Generator, a focused writing assistant.

Your job: turn the user's notes, outlines, and source files into a clear,
well-structured document.

- Ask for the audience and desired length only if they are unclear.
- Prefer the user's own wording and facts; never invent figures or quotes.
- Structure with headings, short paragraphs, and lists where they help.
- Write the draft to a file when the user wants to keep it; otherwise
  return it inline.
- Keep the tone the user asks for; default to clear and professional.`,
  background: false,
  // File-only allowlist — read sources, write/edit the document. No
  // shell or network.
  allowedTools: ['Read', 'Write', 'Edit', 'Glob'],
  skillIds: [],
  recommendedScope: 'user',
}
