import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, type Pinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import { useUiStore } from "../../stores/ui-store.js";
import PlansSection from "./PlansSection.vue";
import { localDayKey } from "../../utils/format-day-label.js";
import type { SectionScope } from "./section-scope.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    userId: "u1",
    workspaceId: null,
    title: "Ship the spring campaign",
    detail: null,
    planDate: "2026-07-23",
    status: "open",
    source: "user",
    sessionId: null,
    completedAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function mountSection(
  scope: SectionScope,
  client: VynelClient,
): { wrapper: ReturnType<typeof mount>; pinia: Pinia } {
  const pinia = createPinia();
  const wrapper = mount(PlansSection, {
    props: { scope },
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
  return { wrapper, pinia };
}

describe("PlansSection", () => {
  it("shows a workspace room only its own + global rows, grouped by day with creator chips", async () => {
    const client = {
      plansUser: {
        list: async () => [
          makePlan({ planDate: "2026-07-24" }),
          makePlan({
            id: "p2",
            workspaceId: "w1",
            title: "Bookkeeping day",
            planDate: "2026-07-23",
            source: "assistant",
          }),
          makePlan({ id: "p3", workspaceId: "OTHER", title: "Elsewhere" }),
        ],
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "workspace", workspaceId: "w1" }, client);
    await flushPromises();

    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Ship the spring campaign");
    expect(wrapper.text()).toContain("Bookkeeping day");
    expect(wrapper.text()).not.toContain("Elsewhere");
    // Two distinct days → two day-group headers.
    expect(wrapper.findAll(".day-label")).toHaveLength(2);
    // The chip says who put it on the list — the user or the assistant.
    expect(wrapper.text()).toContain("You");
    expect(wrapper.text()).toContain("Claude");
  });

  it("the global menu lists ONLY global (null-workspace) plans", async () => {
    const client = {
      plansUser: {
        list: async () => [
          makePlan(),
          makePlan({ id: "p2", workspaceId: "w1", title: "Bookkeeping day" }),
        ],
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Ship the spring campaign");
    expect(wrapper.text()).not.toContain("Bookkeeping day");
  });

  it("creates from the inline composer with today's date default and clears the title", async () => {
    const createCalls: unknown[] = [];
    const client = {
      plansUser: {
        list: async () => [],
        create: async (input: unknown) => {
          createCalls.push(input);
          return makePlan({ id: "p9", workspaceId: "w1", title: "New one" });
        },
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "workspace", workspaceId: "w1" }, client);
    await flushPromises();

    const input = wrapper.get('input[aria-label="New plan title"]');
    await input.setValue("  Plan the launch  ");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(createCalls).toEqual([
      {
        scope: "workspace",
        workspaceId: "w1",
        title: "Plan the launch",
        planDate: localDayKey(),
      },
    ]);
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("cycles status in place: open starts, in-progress completes", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      plansUser: {
        list: async () => [
          makePlan(),
          makePlan({ id: "p2", title: "Already rolling", status: "in-progress" }),
        ],
        update: async (planId: string, patch: unknown) => {
          updateCalls.push([planId, patch]);
          return makePlan({ status: "in-progress" });
        },
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    // The shared status control speaks "plan" here (the noun prop).
    await wrapper.get('[aria-label="Start this plan"]').trigger("click");
    await wrapper.get('[aria-label="Mark this plan done"]').trigger("click");
    await flushPromises();

    expect(updateCalls).toEqual([
      ["p1", { status: "in-progress" }],
      ["p2", { status: "done" }],
    ]);
  });

  it("deletes a row from its hover-reveal control", async () => {
    const deleteCalls: unknown[] = [];
    const client = {
      plansUser: {
        list: async () => [makePlan()],
        delete: async (planId: string) => {
          deleteCalls.push(planId);
        },
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Delete Ship the spring campaign"]')
      .trigger("click");
    await flushPromises();

    expect(deleteCalls).toEqual(["p1"]);
  });

  it("View routes to the SHARED plan viewer (sets viewingPlanId)", async () => {
    const client = {
      plansUser: { list: async () => [makePlan()] },
    } as unknown as VynelClient;

    const { wrapper, pinia } = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="View Ship the spring campaign"]')
      .trigger("click");

    expect(useUiStore(pinia).viewingPlanId).toBe("p1");
  });

  it("Edit opens the edit dialog prefilled and saves the patch", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      plansUser: {
        list: async () => [makePlan()],
        update: async (planId: string, patch: unknown) => {
          updateCalls.push([planId, patch]);
          return makePlan({ title: "Renamed" });
        },
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Edit Ship the spring campaign"]')
      .trigger("click");
    await flushPromises();

    // The dialog portals to body, prefilled from the row. Scope to the
    // dialog — the section's own composer inputs are also in body.
    expect(document.body.textContent).toContain("Edit plan");
    const titleInput = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="text"]',
    );
    expect(titleInput?.value).toBe("Ship the spring campaign");

    titleInput!.value = "Renamed";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    const save = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.trim() === "Save");
    save!.click();
    await flushPromises();

    expect(updateCalls).toEqual([
      ["p1", { title: "Renamed", planDate: "2026-07-23", detail: null }],
    ]);
  });

  it("invites planning when there is nothing yet", async () => {
    const client = {
      plansUser: { list: async () => [] },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    expect(wrapper.text()).toContain("No days planned yet");
  });
});
