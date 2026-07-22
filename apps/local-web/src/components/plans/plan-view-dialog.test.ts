import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, type Pinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import { useUiStore } from "../../stores/ui-store.js";
import PlanViewDialog from "./PlanViewDialog.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

const PLAN = {
  id: "p_1",
  userId: "u1",
  workspaceId: null,
  title: "Launch day",
  detail: "Newsletter + landing page.",
  planDate: "2026-08-01",
  status: "open",
  source: "assistant",
  sessionId: null,
  completedAt: null,
  createdAt: "2026-07-23T10:00:00.000Z",
  updatedAt: "2026-07-23T10:00:00.000Z",
};

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    userId: "u1",
    workspaceId: null,
    title: "Send the newsletter",
    detail: null,
    status: "done",
    source: "assistant",
    sessionId: null,
    planId: "p_1",
    completedAt: null,
    createdAt: "2026-07-23T10:00:00.000Z",
    updatedAt: "2026-07-23T10:00:00.000Z",
    ...overrides,
  };
}

function mountDialog(client: VynelClient): { pinia: Pinia } {
  const pinia = createPinia();
  mount(PlanViewDialog, {
    global: {
      plugins: [
        pinia,
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
    attachTo: document.body,
  });
  return { pinia };
}

describe("PlanViewDialog", () => {
  it("opens off the shared viewingPlanId and shows the plan with its work items", async () => {
    const client = {
      plansUser: { list: async () => [PLAN] },
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({ id: "t2", title: "Update the site", status: "open" }),
          makeTask({ id: "t3", title: "Unrelated", planId: null }),
        ],
      },
    } as unknown as VynelClient;

    const { pinia } = mountDialog(client);
    const ui = useUiStore(pinia);
    expect(document.body.textContent).not.toContain("Launch day");

    ui.viewingPlanId = "p_1";
    await flushPromises();

    expect(document.body.textContent).toContain("Launch day");
    expect(document.body.textContent).toContain("Newsletter + landing page.");
    // Only the tasks carrying this plan's loose ref — with the done rollup.
    expect(document.body.textContent).toContain("Send the newsletter");
    expect(document.body.textContent).toContain("Update the site");
    expect(document.body.textContent).not.toContain("Unrelated");
    expect(document.body.textContent).toContain("1 / 2 done");
  });

  it("says so when the linked plan no longer exists", async () => {
    const client = {
      plansUser: { list: async () => [] },
      tasksUser: { list: async () => [] },
    } as unknown as VynelClient;

    const { pinia } = mountDialog(client);
    useUiStore(pinia).viewingPlanId = "gone";
    await flushPromises();

    expect(document.body.textContent).toContain("Plan not found");
  });
});
