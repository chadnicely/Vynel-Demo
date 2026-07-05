// Maps the identity-seed questionnaire answers into structured memory entries
// (inputs for the injected createMemoryEntry — the structural `MemorySeedEntry`,
// so the leaf never imports @vynel/memory) — replaces the old identity-file seeding (A2:
// retire identity files). The freeform answers become workspace-scoped facts
// the agent sees via the memory capability, tagged with the entry's
// `category` + `section` label (A3 renamed these from the legacy
// identity-file columns).
//
// Spec: docs/blueprints/onboarding/blueprint.md §7 (revised — DB-as-source).

import type { IdentitySeedStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import type { MemorySeedEntry } from '../onboarding-types.js'

export interface BuildMemorySeedEntriesInput {
  userId: string
  workspaceId: string
  answers: IdentitySeedStepInput
}

export function buildMemorySeedEntries(input: BuildMemorySeedEntriesInput): MemorySeedEntry[] {
  const { userId, workspaceId, answers } = input

  const entries: MemorySeedEntry[] = [
    {
      userId,
      workspaceId,
      kind: 'note',
      body: answers.aboutYouParagraph,
      category: 'user',
      section: 'About you',
      createdSource: 'onboarding-seed',
    },
    {
      userId,
      workspaceId,
      kind: 'note',
      body: answers.workspaceContextAnswer,
      category: 'memory',
      section: 'Things to remember',
      createdSource: 'onboarding-seed',
    },
  ]

  // Working style is optional — only seeded when the user answered it.
  if (answers.workingStyleAnswer?.trim()) {
    entries.push({
      userId,
      workspaceId,
      kind: 'preference',
      body: answers.workingStyleAnswer,
      category: 'preferences',
      section: 'Communication style',
      createdSource: 'onboarding-seed',
    })
  }

  return entries
}
