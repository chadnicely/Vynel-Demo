// The room itself: its three columns, the slots P2 fills, the pills bound to
// the session, and the orb fed from the one derivation. The voice session is
// stubbed (happy-dom has no Web Speech and no microphone) — everything else
// runs for real, including the status composable over a quiet API.

import { describe, expect, it, vi } from "vitest";
import type { Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { DisplayOrb, DisplayPanel } from "@vynel/ui";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VoiceCommandSessionView } from "../../composables/voice/voice-command-session-types.js";
import DisplayView from "./DisplayView.vue";

interface VoiceStub {
  view: Ref<VoiceCommandSessionView>;
  failure: Ref<string | null>;
  isActive: Ref<boolean>;
  start: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const voice = vi.hoisted(() => ({}) as VoiceStub);

vi.mock("../../composables/voice/use-voice-session.js", async () => {
  const { computed, onUnmounted, ref } = await import("vue");
  voice.view = ref<VoiceCommandSessionView>({
    state: "ended",
    transcript: "",
    spokenText: "",
    notice: "",
  });
  voice.failure = ref<string | null>(null);
  voice.isActive = computed(
    () => voice.view.value.state !== "ended",
  ) as unknown as Ref<boolean>;
  voice.start = vi.fn(() => {
    voice.view.value = { state: "listening", transcript: "", spokenText: "", notice: "" };
  });
  voice.end = vi.fn(() => {
    voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  });
  // The real composable ends its session on unmount — mirrored here so the
  // stub keeps the same contract, which is what pins the session to the ROOM:
  // created in DisplayView's own setup, its life is the view's life.
  return {
    useVoiceSession: () => {
      onUnmounted(() => voice.end());
      return voice;
    },
  };
});

/** A machine at rest: everything the Display reads, answering empty. */
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

async function mountDisplay() {
  voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  voice.failure.value = null;
  voice.start.mockClear();
  voice.end.mockClear();

  const wrapper = mount(DisplayView, {
    global: {
      plugins: [
        createPinia(),
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      provide: { [vynelClientKey as symbol]: quietClient() },
    },
  });
  await flushPromises();
  return wrapper;
}

function panelTitles(wrapper: Awaited<ReturnType<typeof mountDisplay>>): string[] {
  return wrapper.findAllComponents(DisplayPanel).map((panel) => panel.props("title"));
}

describe("DisplayView", () => {
  it("lays out the two columns around the stage", async () => {
    const wrapper = await mountDisplay();
    expect(wrapper.find('[data-testid="display-column-left"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="display-stage"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="display-column-right"]').exists()).toBe(true);
    expect(panelTitles(wrapper)).toEqual(["System", "Telemetry", "Account", "Legend"]);
  });

  // Empty on purpose (P2 fills them) — but named, so the room reads as
  // unfinished rather than broken.
  it("shows the three widget slots with the hint of what lands there", async () => {
    const wrapper = await mountDisplay();
    for (const slot of ["left", "stage", "right"]) {
      const placeholder = wrapper.find(`[data-testid="display-slot-${slot}"]`);
      expect(placeholder.exists()).toBe(true);
      expect(placeholder.text()).toBe("Claude can put reports here");
    }
  });

  it("reads the app's real status into the panels — quiet when the machine is", async () => {
    const wrapper = await mountDisplay();
    const system = wrapper.findAllComponents(DisplayPanel)[0]!;
    const rows = system.props("rows") as readonly { label: string; value: string }[];
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Link", "offline"],
      ["Working", "nothing running"],
      ["Voice", "quiet"],
      ["Rooms", "none yet"],
      ["Waiting", "nothing"],
    ]);
    const account = wrapper.findAllComponents(DisplayPanel)[2]!;
    expect((account.props("rows") as readonly { value: string }[])[0]!.value).toBe("Chad");
  });

  // The room's session is the ROOM'S: opening it takes the microphone, and
  // leaving by any route — the switch, a menu row, Home — gives it back,
  // because the session is created in this view's setup and dies with it.
  it("starts the session when the room opens and ends it when it closes", async () => {
    const wrapper = await mountDisplay();
    expect(voice.start).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(voice.end).toHaveBeenCalled();
  });

  it("the listening pill mirrors the mic and mutes it", async () => {
    const wrapper = await mountDisplay();
    const pill = wrapper.get('[data-testid="display-listening-pill"]');
    expect(pill.text()).toBe("Listening");

    await pill.trigger("click");
    expect(voice.end).toHaveBeenCalledTimes(1);
    expect(pill.text()).toBe("Muted");

    await pill.trigger("click");
    expect(voice.start).toHaveBeenCalledTimes(2);
    expect(pill.text()).toBe("Listening");
  });

  it("the voice pill hands the microphone back without leaving the room", async () => {
    const wrapper = await mountDisplay();
    const pill = wrapper.get('[data-testid="display-voice-pill"]');
    expect(pill.text()).toBe("Voice off");

    await pill.trigger("click");
    expect(voice.end).toHaveBeenCalledTimes(1);
    expect(pill.text()).toBe("Voice on");
    expect(wrapper.find('[data-testid="display-stage"]').exists()).toBe(true);

    await pill.trigger("click");
    expect(voice.start).toHaveBeenCalledTimes(2);
  });

  it("drives the orb from the session — listening through the reply, speaking with it", async () => {
    const wrapper = await mountDisplay();
    const orb = () => wrapper.getComponent(DisplayOrb);
    expect([orb().props("listening"), orb().props("speaking")]).toEqual([true, false]);

    voice.view.value = {
      state: "speaking",
      transcript: "what is up",
      spokenText: "All quiet.",
      notice: "",
    };
    await wrapper.vm.$nextTick();
    expect([orb().props("listening"), orb().props("speaking")]).toEqual([true, true]);
    // The reply so far is the caption — the same rule the voice stage uses.
    expect(wrapper.find(".caption").text()).toBe("All quiet.");
  });

  // happy-dom has no canvas 2D, so the renderer really does fail here — the
  // room must lose the orb and keep everything that carries the status.
  it("survives a machine the orb cannot draw on", async () => {
    const wrapper = await mountDisplay();
    const stage = wrapper.get('[data-testid="display-stage"]');
    expect(stage.text()).toContain("Orb unavailable");
    expect(panelTitles(wrapper)).toHaveLength(4);
  });

  it("a failure the user must act on takes the caption", async () => {
    const wrapper = await mountDisplay();
    voice.failure.value = "Voice recognition needs Chrome or Edge.";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".caption").text()).toBe("Voice recognition needs Chrome or Edge.");
  });
});
