// Time-aware greeting pieces — the ONE home for them (Home dashboard + the
// global chat's welcome hero). Pure functions so the hour boundaries are
// testable.

export function greetingForHour(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** First word of a display name for the personal greeting; null when empty. */
export function firstNameOf(
  displayName: string | null | undefined,
): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? first : null;
}
