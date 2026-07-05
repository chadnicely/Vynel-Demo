// Display collapse for a delegation trace: the workspace reply and the surfaced
// global report carry the SAME body (the backend trace is deliberately faithful —
// both copies returned, each on its own session). The viewer shows the first
// assistant copy and hides repeats; user rows always render.

export interface CollapsibleTraceEntry {
  role: string
  body: string
}

export function collapseTraceEcho<T extends CollapsibleTraceEntry>(entries: T[]): T[] {
  const seenAssistantBodies = new Set<string>();
  return entries.filter((entry) => {
    if (entry.role !== "assistant") return true;
    const body = entry.body.trim();
    if (seenAssistantBodies.has(body)) return false;
    seenAssistantBodies.add(body);
    return true;
  });
}
