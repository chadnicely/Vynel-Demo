import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";

// Pure context-occupancy arithmetic — one home for "how full is this
// session's window", shared by the composer ring and the Sessions view.

/** What a `usage-reported` event says the model was just sent: uncached input
 *  plus everything read from / written to the cache — the REAL occupancy. */
export function occupancyTokens(usage: {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}): number {
  return (
    usage.inputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens
  );
}

/** A session's settled occupancy from the overview: matched by entry (the
 *  newest segment) or by any chain segment — a history pick shows the number
 *  it forked at, not the successor's. Null when the session isn't listed. */
export function findSessionOccupancy(
  entries: SessionsOverviewEntry[],
  sessionId: string | null,
): { contextTokens: number | null; contextWindow: number } | null {
  if (sessionId === null) return null;
  for (const entry of entries) {
    if (entry.sessionId === sessionId) {
      return {
        contextTokens: entry.contextTokens,
        contextWindow: entry.contextWindow,
      };
    }
    const segment = entry.segments.find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (segment) {
      return {
        contextTokens: segment.contextTokens,
        contextWindow: entry.contextWindow,
      };
    }
  }
  return null;
}

/** "166k" / "1M" / "950" — the compact token count people can read. */
export function formatTokensCompact(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 || Number.isInteger(millions) ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${tokens}`;
}

/** The meter/ring tooltip — the number, plus the continuity promise. */
export function formatContextTooltip(
  tokens: number,
  contextWindow: number,
): string {
  return `~${formatTokensCompact(tokens)} of ${formatTokensCompact(contextWindow)} · continues automatically near 85%`;
}
