// The per-kind starter content for workspaces. Two-consumer cross-cutting
// constant — read by the server scaffold (folder structure on
// createWorkspace) and by the `onboarding` domain's kind picker on
// `apps/web`. Per the second-consumer threshold in
// `.claude/rules/coding-standard.md` "Zod schemas".
//
// Adding a new kind: update the `WorkspaceKind` union here, the
// matching union in `packages/db/src/schema/workspaces/workspaces.ts`
// (kept in sync deliberately — contracts has no `@vynel/db` dep so the
// frontend bundle stays Drizzle-free), the Zod enum in `apps/local-api/src/
// routes/workspaces/schemas.ts`, and the onboarding kind picker. The
// `Readonly<Record<>>` shape forces the type system to flag any
// consumer that didn't handle the new variant.

export type WorkspaceKind = 'small-business' | 'personal' | 'project' | 'custom'

export type WorkspaceKindBundle = {
  readonly kind: WorkspaceKind
  readonly displayName: string
  readonly oneLineDescription: string
  readonly fileSubfolders: ReadonlyArray<string>
}

export const WORKSPACE_KIND_BUNDLES: Readonly<Record<WorkspaceKind, WorkspaceKindBundle>> = {
  'small-business': {
    kind: 'small-business',
    displayName: 'Small Business',
    oneLineDescription: 'Running your business — customers, suppliers, invoices.',
    fileSubfolders: ['Customers', 'Suppliers', 'Invoices', 'Receipts', 'Marketing'],
  },
  personal: {
    kind: 'personal',
    displayName: 'Personal',
    oneLineDescription: 'Personal admin, hobbies, side projects.',
    fileSubfolders: ['Personal', 'Hobbies', 'Admin'],
  },
  project: {
    kind: 'project',
    displayName: 'Project',
    oneLineDescription: 'One focused project with a beginning and end.',
    fileSubfolders: ['References', 'Deliverables', 'Working'],
  },
  custom: {
    kind: 'custom',
    displayName: 'Custom',
    oneLineDescription: "You'll define your own structure.",
    fileSubfolders: [],
  },
}

export const WORKSPACE_KIND_VALUES: ReadonlyArray<WorkspaceKind> = Object.keys(
  WORKSPACE_KIND_BUNDLES,
) as WorkspaceKind[]

export function getWorkspaceKindBundle(kind: WorkspaceKind): WorkspaceKindBundle {
  return WORKSPACE_KIND_BUNDLES[kind]
}
