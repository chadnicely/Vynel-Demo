// Maps the "Help Vynel know you" answers into structured memory entries —
// inputs for the injected createMemoryEntry (the structural `MemorySeedEntry`,
// so the leaf never imports @vynel/memory). The freeform answers become facts
// the agent sees via the memory capability, tagged with the entry's
// `category` + `section` label.
//
// `workspaceId` is null during setup: no project exists yet, and these
// answers are about the PERSON ("tell Vynel about yourself", "how do you like
// to work") — exactly what a null workspaceId means in `memory_entries`: a
// user-level memory owned by the human, not by one project.

import type { IdentitySeedStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import type { MemorySeedEntry } from '../onboarding-types.js'

export interface BuildMemorySeedEntriesInput {
  userId: string
  /** Null = a user-level memory, which is what setup always writes. */
  workspaceId: string | null
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
