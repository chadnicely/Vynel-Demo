import type { SessionEffectiveStatus } from "@vynel/contracts/chat/session-status";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import { activityEnergy, type DisplayActivity } from "./display-orb-state.js";
import type {
  DisplayBoardChange,
  DisplayBoardChangeKind,
} from "./use-display-widgets.js";

// What the Display's panels and strip SAY, as pure functions of flat facts —
// the wiring that gathers those facts lives next door in `use-display-status`.
// Split so the words the room shows can be read, and tested, without a single
// query in the way.

export type DisplayRowTone = "default" | "attention" | "live" | "muted";

export interface DisplayStatusRow {
  readonly label: string;
  readonly value: string;
  readonly tone?: DisplayRowTone;
}

/** The telemetry log's length. Longer is a scrollback nobody reads at a
 *  glance; the room is for what just happened. */
export const TELEMETRY_CAP = 14;

/** What the whole derivation needs — flat, so it tests without a single query. */
export interface DisplayStatusFacts {
  readonly linked: boolean;
  readonly buildingCount: number;
  readonly needYouCount: number;
  readonly roomCount: number;
  readonly roomsWorkingCount: number;
  readonly roomsNeedingYouCount: number;
  readonly voiceStatus: SessionEffectiveStatus | null;
  readonly openTaskCount: number;
  readonly completedTaskCount: number;
  readonly upcomingScheduleCount: number;
  readonly accountName: string;
}

export interface DisplayStatusView {
  readonly linked: boolean;
  readonly building: number;
  readonly needYou: number;
  readonly activity: DisplayActivity;
  readonly orbEnergy: number;
  readonly systemRows: DisplayStatusRow[];
  readonly accountRows: DisplayStatusRow[];
}

const VOICE_WORDS: Record<SessionEffectiveStatus, string> = {
  running: "answering",
  needs_input: "waiting on you",
  problem: "broke",
  completed: "done",
  idle: "quiet",
};

function voiceTone(status: SessionEffectiveStatus | null): DisplayRowTone {
  if (status === null || status === "idle") return "muted";
  if (status === "running") return "live";
  return status === "completed" ? "default" : "attention";
}

/** The orb shows MOTION, not the attention ladder: a fleet mid-build burns
 *  bright even while a card waits, because the strip's counter and the
 *  WAITING row are what call you over — the orb only says "alive". */
function activityOf(facts: DisplayStatusFacts): DisplayActivity {
  if (facts.buildingCount > 0) return "working";
  return facts.needYouCount > 0 ? "needs-input" : "idle";
}

function systemRowsOf(facts: DisplayStatusFacts): DisplayStatusRow[] {
  return [
    {
      label: "Link",
      value: facts.linked ? "connected" : "offline",
      tone: facts.linked ? "live" : "attention",
    },
    {
      label: "Working",
      value:
        facts.buildingCount === 0
          ? "nothing running"
          : `${facts.buildingCount} session${facts.buildingCount === 1 ? "" : "s"}`,
      tone: facts.buildingCount > 0 ? "live" : "muted",
    },
    {
      label: "Voice",
      value: facts.voiceStatus === null ? "quiet" : VOICE_WORDS[facts.voiceStatus],
      tone: voiceTone(facts.voiceStatus),
    },
    {
      label: "Rooms",
      value:
        facts.roomCount === 0
          ? "none yet"
          : `${facts.roomCount} · ${facts.roomsWorkingCount} working · ${facts.roomsNeedingYouCount} need you`,
      tone: facts.roomsNeedingYouCount > 0 ? "attention" : "default",
    },
    {
      label: "Waiting",
      value: facts.needYouCount === 0 ? "nothing" : `${facts.needYouCount} need you`,
      tone: facts.needYouCount > 0 ? "attention" : "muted",
    },
  ];
}

function accountRowsOf(facts: DisplayStatusFacts): DisplayStatusRow[] {
  return [
    { label: "User", value: facts.accountName },
    {
      label: "Tasks",
      value: `${facts.openTaskCount} open · ${facts.completedTaskCount} done`,
      tone: facts.openTaskCount > 0 ? "default" : "muted",
    },
    {
      label: "Schedules",
      value:
        facts.upcomingScheduleCount === 0
          ? "none upcoming"
          : `${facts.upcomingScheduleCount} upcoming`,
      tone: facts.upcomingScheduleCount > 0 ? "default" : "muted",
    },
  ];
}

export function deriveDisplayStatus(facts: DisplayStatusFacts): DisplayStatusView {
  const activity = activityOf(facts);
  return {
    linked: facts.linked,
    building: facts.buildingCount,
    needYou: facts.needYouCount,
    activity,
    orbEnergy: activityEnergy(activity),
    systemRows: systemRowsOf(facts),
    accountRows: accountRowsOf(facts),
  };
}

/** hh:mm:ss on a 24-hour clock — the log's left column and the strip's clock,
 *  formatted here rather than by the locale so the room reads the same on
 *  every machine (and so the tests can assert it). */
export function clockLabel(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

function turnLabel(
  turn: SessionTurnActivity,
  workspaceNames: ReadonlyMap<string, string>,
): string {
  const persona = turn.personaName ?? "";
  if (persona !== "") return persona;
  if (turn.scopeKind === "voice") return "Voice";
  if (turn.scopeKind === "workspace" && turn.workspaceId !== null)
    return workspaceNames.get(turn.workspaceId) ?? "Room";
  return "Claude";
}

/** What changed between two readings of the live turn map, as log lines. */
export function turnTelemetryRows(
  previous: Readonly<Record<string, SessionTurnActivity>>,
  next: Readonly<Record<string, SessionTurnActivity>>,
  at: Date,
  workspaceNames: ReadonlyMap<string, string> = new Map(),
): DisplayStatusRow[] {
  const stamp = clockLabel(at);
  const rows: DisplayStatusRow[] = [];
  for (const [turnId, turn] of Object.entries(next)) {
    if (previous[turnId] === undefined)
      rows.push({ label: stamp, value: `${turnLabel(turn, workspaceNames)} started`, tone: "live" });
  }
  for (const [turnId, turn] of Object.entries(previous)) {
    if (next[turnId] === undefined)
      rows.push({
        label: stamp,
        value: `${turnLabel(turn, workspaceNames)} finished`,
        tone: "default",
      });
  }
  return rows;
}

/** A rise in what waits on you — a fall is you answering it, which needs no
 *  line (you were there). */
export function attentionTelemetryRows(
  previous: number,
  next: number,
  at: Date,
): DisplayStatusRow[] {
  if (next <= previous) return [];
  return [{ label: clockLabel(at), value: `${next} waiting on you`, tone: "attention" }];
}

const BOARD_CHANGE_WORDS: Record<DisplayBoardChangeKind, string> = {
  added: "widget added",
  updated: "widget updated",
  removed: "widget removed",
  cleared: "display cleared",
};

// A card going UP is the loud one — it is the thing you are meant to look at.
const BOARD_CHANGE_TONES: Record<DisplayBoardChangeKind, DisplayRowTone> = {
  added: "live",
  updated: "default",
  removed: "muted",
  cleared: "muted",
};

/** One line for a card appearing, changing or leaving — so the log accounts
 *  for what changed on screen, not only for what ran. */
export function boardTelemetryRows(
  change: DisplayBoardChange,
  at: Date,
): DisplayStatusRow[] {
  const words = BOARD_CHANGE_WORDS[change.kind];
  return [
    {
      label: clockLabel(at),
      value: change.title === null ? words : `${words} · ${change.title}`,
      tone: BOARD_CHANGE_TONES[change.kind],
    },
  ];
}

/** Newest last, capped — the log reads downward like a terminal. */
export function appendTelemetry(
  ring: readonly DisplayStatusRow[],
  rows: readonly DisplayStatusRow[],
): DisplayStatusRow[] {
  return rows.length === 0 ? [...ring] : [...ring, ...rows].slice(-TELEMETRY_CAP);
}
