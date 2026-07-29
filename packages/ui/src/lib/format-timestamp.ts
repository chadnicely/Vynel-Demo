// Compact wall-clock label for a message row: time alone for today, day+time
// once it isn't ("Jul 27 · 14:32"), year added across the boundary. Locale-
// formatted via Intl so the user's clock convention (12h/24h) is respected.

export function formatMessageTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const time = then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (then.toDateString() === now.toDateString()) return time;
  const date = then.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date} · ${time}`;
}

/** Live elapsed label for a running turn/tool call: "4s", "1m 12s", "1h 03m". */
export function formatElapsed(startedAtMs: number, nowMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
