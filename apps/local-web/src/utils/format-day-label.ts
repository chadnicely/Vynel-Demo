// One home for the calendar-day (`YYYY-MM-DD`) presentation both date-wise
// sections share: the day key for "now" in LOCAL time (the server never
// guesses a timezone — the client owns "today"), and the friendly label a
// day-group header wears.

export function localDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "Today" / "Tomorrow" / "Yesterday", else "Mon, Jul 20" (with the year when
 *  it isn't this year). Invalid input falls back to the raw string. */
export function formatDayLabel(dayKey: string, now = new Date()): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return dayKey;
  const date = new Date(year, month - 1, day);

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round(
    (startOfDay(date) - startOfDay(now)) / 86_400_000,
  );
  if (dayDelta === 0) return "Today";
  if (dayDelta === 1) return "Tomorrow";
  if (dayDelta === -1) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}
