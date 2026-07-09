// The schedule dialog's time vocabulary, pure and testable: build a cron from
// a human cadence (daily/weekly/monthly + a time), turn the quick "in 15
// minutes" presets into fire instants, and read a schedule row back as words.

export type RepeatFrequency = "daily" | "weekly" | "monthly";

export interface RepeatCadence {
  frequency: RepeatFrequency;
  /** "HH:MM", 24h — straight from an <input type="time">. */
  time: string;
  /** 0 (Sunday) … 6 (Saturday); weekly only. */
  weekday?: number;
  /** 1 … 31; monthly only. */
  dayOfMonth?: number;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function timeParts(time: string): { hour: number; minute: number } {
  const [hourText = "0", minuteText = "0"] = time.split(":");
  return { hour: Number(hourText), minute: Number(minuteText) };
}

export function buildCronExpression(cadence: RepeatCadence): string {
  const { hour, minute } = timeParts(cadence.time);
  if (cadence.frequency === "weekly") {
    return `${minute} ${hour} * * ${cadence.weekday ?? 1}`;
  }
  if (cadence.frequency === "monthly") {
    return `${minute} ${hour} ${cadence.dayOfMonth ?? 1} * *`;
  }
  return `${minute} ${hour} * * *`;
}

export type OneTimePreset = "in-15-minutes" | "in-1-hour" | "tomorrow-morning";

export const ONE_TIME_PRESETS: { id: OneTimePreset; label: string }[] = [
  { id: "in-15-minutes", label: "In 15 minutes" },
  { id: "in-1-hour", label: "In 1 hour" },
  { id: "tomorrow-morning", label: "Tomorrow 9 AM" },
];

export function fireAtFromPreset(preset: OneTimePreset, now: Date): Date {
  if (preset === "in-15-minutes") return new Date(now.getTime() + 15 * 60_000);
  if (preset === "in-1-hour") return new Date(now.getTime() + 60 * 60_000);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow;
}

function formatTimeOfDay(hour: number, minute: number): string {
  const probe = new Date(2026, 0, 1, hour, minute);
  return probe.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function ordinal(day: number): string {
  const tail = day % 10;
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  if (tail === 1) return `${day}st`;
  if (tail === 2) return `${day}nd`;
  if (tail === 3) return `${day}rd`;
  return `${day}th`;
}

/** A schedule row's cadence, in words: "Daily at 9:00 AM", "Weekly on Monday
 *  at 9:00 AM", "Monthly on the 1st at 9:00 AM", "Once" — falling back to the
 *  raw cron when it isn't one of the dialog's shapes. */
export function describeScheduleCadence(schedule: {
  scheduleKind: "recurring" | "one-time";
  cronExpression: string | null;
}): string {
  if (schedule.scheduleKind === "one-time") return "Once";
  const cron = schedule.cronExpression ?? "";

  const daily = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (daily) {
    return `Daily at ${formatTimeOfDay(Number(daily[2]), Number(daily[1]))}`;
  }
  const weekly = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* (\d)$/);
  if (weekly) {
    const weekday = WEEKDAY_NAMES[Number(weekly[3])] ?? `day ${weekly[3]}`;
    return `Weekly on ${weekday} at ${formatTimeOfDay(Number(weekly[2]), Number(weekly[1]))}`;
  }
  const monthly = cron.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/);
  if (monthly) {
    return `Monthly on the ${ordinal(Number(monthly[3]))} at ${formatTimeOfDay(Number(monthly[2]), Number(monthly[1]))}`;
  }
  return cron ? `Custom (${cron})` : "Repeats";
}
