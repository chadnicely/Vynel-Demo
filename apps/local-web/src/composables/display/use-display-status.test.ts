import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useDisplayStatus, type DisplayStatus } from "./use-display-status.js";

// The wiring above the pure derivations: what the composable itself watches,
// and what it must let go of when the room closes.

/** A machine at rest: every read the composable makes, answering empty. */
function quietClient(): VynelClient {
  return {
    dashboard: {
      getOverview: async () => ({
        workspaces: [],
        recentSessions: [],
        upcomingSchedules: [],
        openTasks: [],
        recentlyCompletedTasks: [],
      }),
    },
    workspaces: { listStatuses: async () => [] },
    approvals: { listPending: async () => [] },
    asks: { listPending: async () => [] },
    users: { getMe: async () => ({ displayName: "Chad", emailAddress: null }) },
    root: {
      getVoiceStatus: async () => ({ entry: null }),
      listDelegations: async () => ({ delegations: [] }),
    },
    chat: {
      getContinuing: async () => ({
        rootSessionId: null,
        currentSdkSessionId: null,
        lastMessageAt: null,
      }),
    },
    sessions: { overview: async () => [] },
  } as unknown as VynelClient;
}

/** `seed` runs before the composable exists — what the feed already knew. */
async function mountStatus(seed?: (activity: ReturnType<typeof useActivityStore>) => void) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const activity = useActivityStore();
  seed?.(activity);

  let status!: DisplayStatus;
  const wrapper = mount(
    defineComponent({
      setup() {
        status = useDisplayStatus();
        return () => h("div");
      },
    }),
    {
      global: {
        plugins: [
          pinia,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ],
        provide: { [vynelClientKey as symbol]: quietClient() },
      },
    },
  );
  await flushPromises();
  return { wrapper, activity, status: () => status };
}

const startedTurn = {
  kind: "turn-started",
  turnId: "turn-1",
  scopeKind: "global",
  workspaceId: null,
  sessionId: null,
  origin: "web",
  startedAt: "2026-08-21T10:00:00.000Z",
} as const;
const endedTurn = {
  kind: "turn-ended",
  turnId: "turn-1",
  sessionId: null,
  outcome: "ended",
} as const;

describe("useDisplayStatus", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs each turn into the ring as it starts and again as it finishes", async () => {
    const { wrapper, activity, status } = await mountStatus();
    expect(status().telemetry.value).toEqual([]);

    activity.applyServerActivity(startedTurn);
    await nextTick();
    expect(status().telemetry.value.at(-1)?.value).toBe("Claude started");

    activity.applyServerActivity(endedTurn);
    await nextTick();
    expect(status().telemetry.value.at(-1)?.value).toBe("Claude finished");
    wrapper.unmount();
  });

  // The feed replays every in-flight turn when it subscribes — at app boot,
  // long before this room opened. The log carries what happened WHILE you
  // watched, not a burst of history the moment you walk in.
  it("baselines on what was already running", async () => {
    const { wrapper, activity, status } = await mountStatus((seeded) =>
      seeded.applyServerActivity(startedTurn),
    );
    expect(status().telemetry.value).toEqual([]);

    activity.applyServerActivity(endedTurn);
    await nextTick();
    expect(status().telemetry.value.map((row) => row.value)).toEqual(["Claude finished"]);
    wrapper.unmount();
  });

  // Only `setInterval`/`clearInterval`/`Date` are faked — `flushPromises`
  // still needs a real `setTimeout` to settle the queries.
  it("ticks its clock every second and lets it go when the room closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date(2026, 7, 21, 9, 4, 5));
    const { wrapper, status } = await mountStatus();
    expect(status().clock.value).toBe("09:04:05");

    vi.advanceTimersByTime(1000);
    expect(status().clock.value).toBe("09:04:06");

    // A room left open all day must not leave a second's tick behind it.
    wrapper.unmount();
    vi.advanceTimersByTime(5000);
    expect(status().clock.value).toBe("09:04:06");
  });
});
