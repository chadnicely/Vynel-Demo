// One home for turning a delegation's raw task text (the brain's full
// instruction — possibly multi-line) into the short human label the UI chips
// wear ("vynel · Set up the login page"). Derived server-side wherever a
// delegation surfaces (the in-flight indicator, an enriched report row) so
// every surface shows the same words; visual truncation stays CSS.

const MAX_TASK_LABEL_LENGTH = 120

export function deriveDelegationTaskLabel(taskText: string): string {
  const firstLine =
    taskText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  const collapsed = firstLine.replace(/\s+/g, ' ')
  return collapsed.length > MAX_TASK_LABEL_LENGTH
    ? `${collapsed.slice(0, MAX_TASK_LABEL_LENGTH - 1).trimEnd()}…`
    : collapsed
}
