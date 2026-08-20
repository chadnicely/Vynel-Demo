import { computed, onUnmounted, ref, watch, type ComputedRef, type Ref } from "vue";
import type { SessionEffectiveStatus } from "@vynel/contracts/chat/session-status";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import { useActivityStore } from "../../stores/activity-store.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import { useWorkingRail } from "../activity/use-working-rail.js";
import { useWorkspaceStatuses } from "../workspaces/use-workspace-status.js";
import { useVoiceChatStatus } from "../sessions/use-voice-chat-status.js";
import { usePendingApprovals } from "../approvals/use-pending-approvals.js";
import { usePendingAsks } from "../asks/use-pending-asks.js";
import { useDashboardOverview } from "../dashboard/use-dashboard-overview.js";
import { useCurrentUser } from "../users/use-current-user.js";
import { activityEnergy, type DisplayActivity } from "./display-orb-state.js";

// Everything the Display's panels and strip show, derived in ONE place from
// the reads the app ALREADY holds — the live socket, the working rail, the
// workspace rollup, the spoken thread's own status, the approval/ask polls,
// the Home overview. The Display opens no door of its own: it is a reading of
// the app, and a reading that polled on its own would drift from every other
// surface.

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

/** Newest last, capped — the log reads downward like a terminal. */
export function appendTelemetry(
  ring: readonly DisplayStatusRow[],
  rows: readonly DisplayStatusRow[],
): DisplayStatusRow[] {
  return rows.length === 0 ? [...ring] : [...ring, ...rows].slice(-TELEMETRY_CAP);
}

export interface DisplayStatus {
  readonly status: ComputedRef<DisplayStatusView>;
  readonly telemetry: Ref<DisplayStatusRow[]>;
  readonly clock: Ref<string>;
}

export function useDisplayStatus(): DisplayStatus {
  const liveChannel = useLiveChannelStore();
  const activity = useActivityStore();
  const rail = useWorkingRail();
  const { statusByWorkspaceId } = useWorkspaceStatuses();
  const voiceChat = useVoiceChatStatus();
  const approvalsQuery = usePendingApprovals();
  const asksQuery = usePendingAsks();
  // The Home cadence: poll only while something runs (dashboard-overview's own
  // contract), so an open Display costs nothing on a quiet machine.
  const overviewQuery = useDashboardOverview(() => (activity.isTurnRunning ? 5000 : false));
  const currentUserQuery = useCurrentUser();

  const needYouCount = computed(
    () => (approvalsQuery.data.value?.length ?? 0) + (asksQuery.data.value?.length ?? 0),
  );

  const workspaceNames = computed(
    () =>
      new Map(
        (overviewQuery.data.value?.workspaces ?? []).map((room) => [room.id, room.name]),
      ),
  );

  const facts = computed<DisplayStatusFacts>(() => {
    const rooms = Object.values(statusByWorkspaceId.value);
    return {
      // Strictly OPEN, deliberately: a reconnecting socket means the panels
      // ARE stale, and the strip says exactly that. The cost is a visible
      // flip during the store's backoff — honest beats soothing on a room
      // the user leaves up all day.
      linked: liveChannel.status === "open",
      // The rail already folded the feed and the in-flight poll into one
      // entity per working identity — counting raw turns would double the
      // same session.
      buildingCount: rail.entities.value.filter((entity) => entity.isWorking).length,
      needYouCount: needYouCount.value,
      roomCount: overviewQuery.data.value?.workspaces.length ?? 0,
      roomsWorkingCount: rooms.filter((room) => room.status === "running").length,
      roomsNeedingYouCount: rooms.filter(
        (room) => room.status === "needs_input" || room.status === "problem",
      ).length,
      voiceStatus: voiceChat.status.value?.status ?? null,
      openTaskCount: overviewQuery.data.value?.openTasks.length ?? 0,
      completedTaskCount: overviewQuery.data.value?.recentlyCompletedTasks.length ?? 0,
      upcomingScheduleCount: overviewQuery.data.value?.upcomingSchedules.length ?? 0,
      accountName: currentUserQuery.data.value?.displayName ?? "You",
    };
  });

  const telemetry = ref<DisplayStatusRow[]>([]);
  // Baselined at setup, not at the first change: the feed replays every
  // in-flight turn when it subscribes, and that happens at app boot — long
  // before this room opens. Starting from what is already running means the
  // log carries what happened WHILE you watched.
  let knownTurns: Readonly<Record<string, SessionTurnActivity>> = { ...activity.serverTurns };
  watch(
    () => activity.serverTurns,
    (next) => {
      telemetry.value = appendTelemetry(
        telemetry.value,
        turnTelemetryRows(knownTurns, next, new Date(), workspaceNames.value),
      );
      knownTurns = { ...next };
    },
  );

  let knownNeedYou = needYouCount.value;
  watch(needYouCount, (next) => {
    telemetry.value = appendTelemetry(
      telemetry.value,
      attentionTelemetryRows(knownNeedYou, next, new Date()),
    );
    knownNeedYou = next;
  });

  const clock = ref(clockLabel(new Date()));
  const clockTimer = setInterval(() => {
    clock.value = clockLabel(new Date());
  }, 1000);
  onUnmounted(() => clearInterval(clockTimer));

  return { status: computed(() => deriveDisplayStatus(facts.value)), telemetry, clock };
}
