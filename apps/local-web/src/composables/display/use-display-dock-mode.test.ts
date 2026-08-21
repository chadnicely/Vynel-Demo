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
}) {
  setActivePinia(createPinia());
  let dock!: ComputedRef<DisplayDockLayoutState>;
  const wrapper = mount(
    defineComponent({
      setup() {
        dock = useDisplayDockMode({
          isConversationInHand: () => inputs.isConversationInHand.value === true,
          isAppDisplayActive: () => inputs.isAppDisplayActive.value === true,
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
