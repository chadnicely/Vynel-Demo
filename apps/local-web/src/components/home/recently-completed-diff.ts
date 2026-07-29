// The celebration guard: a task celebrates ONLY when it was seen open in the
// previous snapshot and completed in this one — never on initial load, never
// replayed on refetch. Pure, so the rule is unit-testable.

export function newlyCompletedIds(
  previousOpenIds: ReadonlySet<string>,
  completedRows: ReadonlyArray<{ id: string }>,
): string[] {
  return completedRows
    .filter((row) => previousOpenIds.has(row.id))
    .map((row) => row.id);
}
