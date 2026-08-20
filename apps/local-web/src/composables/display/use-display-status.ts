import { computed, onUnmounted, ref, watch, type ComputedRef, type Ref } from "vue";
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
import {
  appendTelemetry,
  attentionTelemetryRows,
  deriveDisplayStatus,
  clockLabel,
  turnTelemetryRows,
  type DisplayStatusFacts,
  type DisplayStatusRow,
  type DisplayStatusView,
} from "./display-status-rows.js";

// Everything the Display's panels and strip show, derived in ONE place from
// the reads the app ALREADY holds — the live socket, the working rail, the
// workspace rollup, the spoken thread's own status, the approval/ask polls,
// the Home overview. The Display opens no door of its own: it is a reading of
// the app, and a reading that polled on its own would drift from every other
// surface. (The words themselves are `display-status-rows.ts`.)

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
  // before this room opened. Starting from what is already running means the
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
