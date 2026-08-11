import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

// The approvals + workspace queries and the browser store are all live-data
// seams; stub them so the test is about ONE thing — where the toasts dock and
// which approvals reach them.
const pendingData = ref<Array<Record<string, unknown>>>([]);
const isTauri = ref(false);
const browserOpen = ref(false);

vi.mock("../../composables/approvals/use-pending-approvals.js", () => ({
  usePendingApprovals: () => ({ data: pendingData }),
}));
vi.mock("../../composables/approvals/use-decide-approval.js", () => ({
  useDecideApproval: () => ({ mutate: vi.fn(), isPending: ref(false) }),
}));
vi.mock("../../composables/workspaces/use-workspace-list.js", () => ({
  useWorkspaceList: () => ({ data: ref([]) }),
}));
vi.mock("../../stores/browser-store.js", () => ({
  useBrowserStore: () => ({
    get isOpen() {
      return browserOpen.value;
    },
  }),
}));
vi.mock("../../composables/voice/tauri-overlay-window.js", () => ({
  isTauriShell: () => isTauri.value,
}));

const { default: ApprovalNotifier } = await import("./ApprovalNotifier.vue");

function approval(toolName: string, id = toolName) {
  return {
    id,
    providerApprovalId: `p-${id}`,
    toolName,
    toolInput: {},
    actionKind: "other",
    workspaceId: null,
  };
}

beforeEach(() => {
  pendingData.value = [];
  isTauri.value = false;
  browserOpen.value = false;
});

describe("ApprovalNotifier", () => {
  it("docks bottom-RIGHT in a plain browser with no page webview open", () => {
    pendingData.value = [approval("Bash")];
    const wrapper = mount(ApprovalNotifier);
    expect(wrapper.find(".approval-notifier").classes()).not.toContain("dock-start");
  });

  it("docks AWAY from the right inside the desktop shell", () => {
    // The desktop overlay is an always-on-top window parked at the screen's
    // bottom-right — the same pixels these toasts use once the main window is
    // maximized. A card under it is invisible AND unclickable, so its turn
    // parks forever with nothing on screen explaining why (live smoke,
    // 2026-08-11). Docking left is what keeps a card decidable.
    isTauri.value = true;
    pendingData.value = [approval("Bash")];
    const wrapper = mount(ApprovalNotifier);
    expect(wrapper.find(".approval-notifier").classes()).toContain("dock-start");
  });

  it("still docks away when the page webview owns the right side", () => {
    browserOpen.value = true;
    pendingData.value = [approval("Bash")];
    const wrapper = mount(ApprovalNotifier);
    expect(wrapper.find(".approval-notifier").classes()).toContain("dock-start");
  });

  it("leaves DESKTOP approvals to the overlay inside the shell, but shows them in a browser", () => {
    // The two surfaces must be exact complements — a desktop card that neither
    // renders is the same invisible-park failure by a different route.
    isTauri.value = true;
    pendingData.value = [approval("mcp__desktop__request_desktop_access")];
    expect(mount(ApprovalNotifier).findAll(".toast")).toHaveLength(0);

    isTauri.value = false;
    expect(mount(ApprovalNotifier).findAll(".toast")).toHaveLength(1);
  });

  it("keeps non-desktop approvals in the shell — the overlay never shows those", () => {
    isTauri.value = true;
    pendingData.value = [approval("Bash"), approval("mcp__desktop__act_on_app")];
    const wrapper = mount(ApprovalNotifier);
    expect(wrapper.findAll(".toast")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("act_on_app");
  });
});
