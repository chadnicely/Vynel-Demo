import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, type ComputedRef } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useDesktopActivityStore } from "../../stores/desktop-activity-store.js";
import { emptyDesktopActivity } from "../../stores/desktop-activity-fold.js";
import {
  displayDockLayout,
  useDisplayDockMode,
  DISPLAY_DOCK_MINI_SIZE,
  DISPLAY_DOCK_WAKE_SIZE,
  type DisplayDockLayoutState,
  type DisplayDockPresence,
} from "./use-display-dock-mode.js";

// The dock window mounts its own activity subscription — a live socket is not
// what these cases are about, so the feed is a no-op and the desktop-activity
// store is driven directly.
vi.mock("../activity/use-session-activity-feed.js", () => ({
  useSessionActivityFeed: () => {},
}));

function presence(overrides: Partial<DisplayDockPresence> = {}): DisplayDockPresence {
  return {
    isConversationInHand: false,
    isAppDisplayActive: false,
    wasTakenOverByTheRoom: false,
    isAppSessionLive: false,
    isAssistantLineAudible: false,
    isDesktopOverlayVisible: false,
    ...overrides,
  };
}

describe("displayDockLayout", () => {
  it("shows nothing with no conversation in hand", () => {
    expect(displayDockLayout(presence()).mode).toBe("hidden");
    // Even with the room off screen and a desktop task running.
    expect(
      displayDockLayout(presence({ isDesktopOverlayVisible: true })).mode,
    ).toBe("hidden");
  });

  it("puts a fresh wake conversation in the middle of the screen", () => {
    const state = displayDockLayout(presence({ isConversationInHand: true }));
    expect(state.mode).toBe("wake");
    expect(state.park).toBe("center");
    expect(state.stackAboveDesktopControl).toBe(false);
    expect(state.layout).toEqual({
      park: "center",
      width: DISPLAY_DOCK_WAKE_SIZE.width,
      height: DISPLAY_DOCK_WAKE_SIZE.height,
    });
  });

  // The room owns the orb whenever it is on screen — whichever shape the dock
  // would otherwise be in.
  it("hides while the app's Display has the room", () => {
    expect(
      displayDockLayout(
        presence({ isConversationInHand: true, isAppDisplayActive: true }),
      ).mode,
    ).toBe("hidden");
    expect(
      displayDockLayout(
        presence({
          isConversationInHand: true,
          isAppDisplayActive: true,
          wasTakenOverByTheRoom: true,
        }),
      ).mode,
    ).toBe("hidden");
  });

  it("goes mini in the corner once the room has had the conversation", () => {
    const state = displayDockLayout(
      presence({ isConversationInHand: true, wasTakenOverByTheRoom: true }),
    );
    expect(state.mode).toBe("mini");
    expect(state.park).toBe("bottom-right");
    expect(state.stackAboveDesktopControl).toBe(false);
    expect(state.layout).toEqual({
      park: "bottom-right",
      width: DISPLAY_DOCK_MINI_SIZE.width,
      height: DISPLAY_DOCK_MINI_SIZE.height,
    });
  });

  it("stacks the mini row above the desktop-control overlay", () => {
    const state = displayDockLayout(
      presence({
        isConversationInHand: true,
        wasTakenOverByTheRoom: true,
        isDesktopOverlayVisible: true,
      }),
    );
    expect(state.stackAboveDesktopControl).toBe(true);
    expect(state.layout.stackAbove).toEqual({ heightPx: 360 });
  });

  // Kafi's ask: talking to the room, then switching to a workspace. The
  // session never left the app window — the dock MIRRORS it in the corner.
  it("mirrors the app's own session in the corner while the room is off screen", () => {
    const state = displayDockLayout(presence({ isAppSessionLive: true }));
    expect(state.mode).toBe("mini");
    expect(state.isMirror).toBe(true);
    expect(state.park).toBe("bottom-right");
    expect(state.layout).toEqual({
      park: "bottom-right",
      width: DISPLAY_DOCK_MINI_SIZE.width,
      height: DISPLAY_DOCK_MINI_SIZE.height,
    });
  });

  // One orb per conversation: while the room itself is on screen it draws it.
  it("hides the mirror while the app's Display has the room", () => {
    expect(
      displayDockLayout(presence({ isAppSessionLive: true, isAppDisplayActive: true })).mode,
    ).toBe("hidden");
  });

  // The dock has a microphone in THIS window; a mirror is only a report.
  it("lets the dock's own conversation win over a mirror", () => {
    const wake = displayDockLayout(
      presence({ isConversationInHand: true, isAppSessionLive: true }),
    );
    expect(wake.mode).toBe("wake");
    expect(wake.isMirror).toBe(false);

    const mini = displayDockLayout(
      presence({
        isConversationInHand: true,
        wasTakenOverByTheRoom: true,
        isAppSessionLive: true,
      }),
    );
    expect(mini.mode).toBe("mini");
    expect(mini.isMirror).toBe(false);
  });

  // The `show-dock` path: a proactive spoken line with no session anywhere
  // still gets pixels — the mirror-shaped corner row, for the line's life.
  it("shows the spoken-line row while the assistant is audible with no session", () => {
    const state = displayDockLayout(presence({ isAssistantLineAudible: true }));
    expect(state.mode).toBe("mini");
    expect(state.isMirror).toBe(true);
    expect(state.park).toBe("bottom-right");
  });

  // One orb: the room on screen draws the assistant, whatever is being said.
  it("hides the spoken-line row while the app's Display has the room", () => {
    expect(
      displayDockLayout(
        presence({ isAssistantLineAudible: true, isAppDisplayActive: true }),
      ).mode,
    ).toBe("hidden");
  });

  it("lets a conversation or a session mirror win over the spoken-line row", () => {
    const own = displayDockLayout(
      presence({ isConversationInHand: true, isAssistantLineAudible: true }),
    );
    expect(own.mode).toBe("wake");
    expect(own.isMirror).toBe(false);

    const mirror = displayDockLayout(
      presence({ isAppSessionLive: true, isAssistantLineAudible: true }),
    );
    expect(mirror.mode).toBe("mini");
    expect(mirror.isMirror).toBe(true);
  });

  it("stacks a mirrored row above the desktop-control overlay too", () => {
    const state = displayDockLayout(
      presence({ isAppSessionLive: true, isDesktopOverlayVisible: true }),
    );
    expect(state.isMirror).toBe(true);
    expect(state.stackAboveDesktopControl).toBe(true);
    expect(state.layout.stackAbove).toEqual({ heightPx: 360 });
  });

  // Nothing stacks in the middle of the screen, and nothing stacks under a
  // window that is not on screen.
  it("never carries a stack offset outside the mini corner", () => {
    expect(
      displayDockLayout(
        presence({ isConversationInHand: true, isDesktopOverlayVisible: true }),
      ).layout.stackAbove,
    ).toBeUndefined();
    expect(
      displayDockLayout(presence({ isDesktopOverlayVisible: true })).layout.stackAbove,
    ).toBeUndefined();
  });
});

async function mountDockMode(inputs: {
  isConversationInHand: ReturnType<typeof ref<boolean>>;
  isAppDisplayActive: ReturnType<typeof ref<boolean>>;
  isAppSessionLive?: ReturnType<typeof ref<boolean>>;
  isAssistantLineAudible?: ReturnType<typeof ref<boolean>>;
}) {
  setActivePinia(createPinia());
  let dock!: ComputedRef<DisplayDockLayoutState>;
  const wrapper = mount(
    defineComponent({
      setup() {
        dock = useDisplayDockMode({
          isConversationInHand: () => inputs.isConversationInHand.value === true,
          isAppDisplayActive: () => inputs.isAppDisplayActive.value === true,
          isAppSessionLive: () => inputs.isAppSessionLive?.value === true,
          isAssistantLineAudible: () => inputs.isAssistantLineAudible?.value === true,
        });
        return () => h("div");
      },
    }),
  );
  return { wrapper, dock: () => dock, desktopActivity: useDesktopActivityStore() };
}

describe("useDisplayDockMode", () => {
  it("demotes the wake conversation to mini once the room takes it and gives it back", async () => {
    const isConversationInHand = ref(false);
    const isAppDisplayActive = ref(false);
    const { dock, wrapper } = await mountDockMode({
      isConversationInHand,
      isAppDisplayActive,
    });
    expect(dock().value.mode).toBe("hidden");

    isConversationInHand.value = true;
    await wrapper.vm.$nextTick();
    expect(dock().value.mode).toBe("wake");

    // The app opened on the Display and took the conversation over.
    isAppDisplayActive.value = true;
    await wrapper.vm.$nextTick();
    expect(dock().value.mode).toBe("hidden");

    // The user left the Display mid-conversation — the dock is a corner
    // widget for the rest of it, never the middle of the screen again.
    isAppDisplayActive.value = false;
    await wrapper.vm.$nextTick();
    expect(dock().value.mode).toBe("mini");
  });

  it("gives the next conversation the middle of the screen back", async () => {
    const isConversationInHand = ref(true);
    const isAppDisplayActive = ref(true);
    const { dock, wrapper } = await mountDockMode({
      isConversationInHand,
      isAppDisplayActive,
    });

    isAppDisplayActive.value = false;
    await wrapper.vm.$nextTick();
    expect(dock().value.mode).toBe("mini");

    isConversationInHand.value = false;
    await wrapper.vm.$nextTick();
    expect(dock().value.mode).toBe("hidden");

    isConversationInHand.value = true;
    await wrapper.vm.$nextTick();
    expect(dock().value.mode).toBe("wake");
  });

  // The latch belongs to the dock's OWN conversation — a mirror is somebody
  // else's and never earns the middle of the screen for the next wake.
  it("does not let a mirror latch the next wake into the corner", async () => {
    const isConversationInHand = ref(false);
    const isAppDisplayActive = ref(false);
    const isAppSessionLive = ref(true);
    const { dock, wrapper } = await mountDockMode({
      isConversationInHand,
      isAppDisplayActive,
      isAppSessionLive,
    });
    expect(dock().value.mode).toBe("mini");
    expect(dock().value.isMirror).toBe(true);

    // The room came forward while it was talking — the mirror steps aside.
    isAppDisplayActive.value = true;
    await wrapper.vm.$nextTick();
    expect(dock().value.mode).toBe("hidden");

    // …and a wake lands here afterwards: the middle of the screen, as always.
    isAppDisplayActive.value = false;
    isAppSessionLive.value = false;
    isConversationInHand.value = true;
    await wrapper.vm.$nextTick();
    expect(dock().value.mode).toBe("wake");
    expect(dock().value.isMirror).toBe(false);
  });

  // Same rule, one home: the offset follows the desktop-control window's OWN
  // idea of when it is up, read off the store both windows fold into.
  it("stacks while the desktop-control overlay is up", async () => {
    const isConversationInHand = ref(true);
    const isAppDisplayActive = ref(true);
    const { dock, wrapper, desktopActivity } = await mountDockMode({
      isConversationInHand,
      isAppDisplayActive,
    });
    isAppDisplayActive.value = false;
    await wrapper.vm.$nextTick();
    expect(dock().value.stackAboveDesktopControl).toBe(false);

    desktopActivity.state = {
      ...emptyDesktopActivity(),
      pendingApprovalIds: ["approval-1"],
    };
    await wrapper.vm.$nextTick();
    expect(dock().value.stackAboveDesktopControl).toBe(true);
    expect(dock().value.layout.stackAbove).toEqual({ heightPx: 360 });
  });
});
