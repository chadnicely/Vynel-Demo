import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, type Pinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import { useUiStore } from "../../stores/ui-store.js";
import TasksSection from "./TasksSection.vue";
import type { SectionScope } from "./section-scope.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    userId: "u1",
    workspaceId: null,
    title: "Ship the launch email",
    detail: null,
    status: "open",
    source: "user",
    sessionId: null,
    planId: null,
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
  const wrapper = mount(TasksSection, {
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

describe("TasksSection", () => {
  it("shows a workspace room only its own + global rows, with creator chips", async () => {
    const client = {
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({
            id: "t2",
            workspaceId: "w1",
            title: "Draft the brief",
            source: "assistant",
          }),
          makeTask({ id: "t3", workspaceId: "OTHER", title: "Elsewhere" }),
        ],
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "workspace", workspaceId: "w1" }, client);
    await flushPromises();

    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Ship the launch email");
    expect(wrapper.text()).toContain("Draft the brief");
    expect(wrapper.text()).not.toContain("Elsewhere");
    // The chip says who put it on the list — the user or the assistant.
    expect(wrapper.text()).toContain("You");
    expect(wrapper.text()).toContain("Claude");
  });

  it("the global menu lists ONLY global (null-workspace) tasks", async () => {
    const client = {
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({ id: "t2", workspaceId: "w1", title: "Draft the brief" }),
        ],
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Ship the launch email");
    expect(wrapper.text()).not.toContain("Draft the brief");
  });

  it("creates from the inline composer and clears it (Enter submits)", async () => {
    const createCalls: unknown[] = [];
    const client = {
      tasksUser: {
        list: async () => [],
        create: async (input: unknown) => {
          createCalls.push(input);
          return makeTask({ id: "t9", workspaceId: "w1", title: "New one" });
        },
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "workspace", workspaceId: "w1" }, client);
    await flushPromises();

    const input = wrapper.get('input[aria-label="New task title"]');
    await input.setValue("  Book the venue  ");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(createCalls).toEqual([
      { scope: "workspace", workspaceId: "w1", title: "Book the venue" },
    ]);
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("cycles status in place: open starts, in-progress completes", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({ id: "t2", title: "Already rolling", status: "in-progress" }),
        ],
        update: async (taskId: string, patch: unknown) => {
          updateCalls.push([taskId, patch]);
          return makeTask({ status: "in-progress" });
        },
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper.get('[aria-label="Start this task"]').trigger("click");
    await wrapper.get('[aria-label="Mark this task done"]').trigger("click");
    await flushPromises();

    expect(updateCalls).toEqual([
      ["t1", { status: "in-progress" }],
      ["t2", { status: "done" }],
    ]);
  });

  it("collapses done work behind the disclosure, with when it finished", async () => {
    const client = {
      tasksUser: {
        list: async () => [
          makeTask(),
          makeTask({
            id: "t2",
            title: "Wrapped up",
            status: "done",
            completedAt: "2026-07-16T10:00:00.000Z",
          }),
        ],
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    // Collapsed by default — the archive never crowds the live list.
    expect(wrapper.text()).not.toContain("Wrapped up");
    const toggle = wrapper.get(".done-toggle");
    expect(toggle.text()).toContain("Done · 1");

    await toggle.trigger("click");
    expect(wrapper.text()).toContain("Wrapped up");
    expect(wrapper.text()).toMatch(/Done (just now|.+ ago)/);
  });

  it("deletes a row from its hover-reveal control", async () => {
    const deleteCalls: unknown[] = [];
    const client = {
      tasksUser: {
        list: async () => [makeTask()],
        delete: async (taskId: string) => {
          deleteCalls.push(taskId);
        },
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Delete Ship the launch email"]')
      .trigger("click");
    await flushPromises();

    expect(deleteCalls).toEqual(["t1"]);
  });

  it("View opens the task dialog with a LIVE status cycle; its plan chip routes to the shared plan viewer", async () => {
    // Mutable backing list — the update mock rewrites it, the refetch serves
    // it, and the dialog must track the LIVE row (a stale snapshot would
    // re-send the same transition forever).
    const rows = [makeTask({ detail: "Cover the spring menu.", planId: "p_1" })];
    const updateCalls: unknown[] = [];
    const client = {
      tasksUser: {
        // Fresh array per fetch — returning the cached reference would defeat
        // vue-query's structural sharing and hide the update.
        list: async () => [...rows],
        update: async (taskId: string, patch: { status: string }) => {
          updateCalls.push([taskId, patch]);
          rows[0] = makeTask({
            detail: "Cover the spring menu.",
            planId: "p_1",
            status: patch.status,
          });
          return rows[0];
        },
      },
    } as unknown as VynelClient;

    const { wrapper, pinia } = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="View Ship the launch email"]')
      .trigger("click");
    await flushPromises();

    expect(document.body.textContent).toContain("Cover the spring menu.");

    const dialogStatus = () =>
      document.body.querySelector<HTMLButtonElement>(
        '[role="dialog"] .status-control',
      );
    dialogStatus()!.click();
    // The invalidate → refetch → re-render chain crosses several ticks; wait
    // until the dialog actually shows the new status before cycling again.
    await vi.waitFor(() =>
      expect(
        document.body.querySelector('[role="dialog"]')?.textContent,
      ).toContain("in-progress"),
    );
    dialogStatus()!.click();
    await flushPromises();

    // Two clicks advance TWO transitions — the dialog re-resolved the row.
    expect(updateCalls).toEqual([
      ["t1", { status: "in-progress" }],
      ["t1", { status: "done" }],
    ]);

    const planChip = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="View the linked plan"]',
    );
    planChip!.click();
    expect(useUiStore(pinia).viewingPlanId).toBe("p_1");
  });

  it("Edit opens the edit dialog prefilled and saves the patch", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      tasksUser: {
        list: async () => [makeTask()],
        update: async (taskId: string, patch: unknown) => {
          updateCalls.push([taskId, patch]);
          return makeTask({ title: "Renamed" });
        },
      },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Edit Ship the launch email"]')
      .trigger("click");
    await flushPromises();

    expect(document.body.textContent).toContain("Edit task");
    // Scope to the dialog — the section's own composer input is also in body.
    const titleInput = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="text"]',
    );
    expect(titleInput?.value).toBe("Ship the launch email");

    titleInput!.value = "Renamed";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    const save = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.trim() === "Save");
    save!.click();
    await flushPromises();

    expect(updateCalls).toEqual([["t1", { title: "Renamed", detail: null }]]);
  });

  it("invites adding when there is nothing yet", async () => {
    const client = {
      tasksUser: { list: async () => [] },
    } as unknown as VynelClient;

    const { wrapper } = mountSection({ kind: "global" }, client);
    await flushPromises();

    expect(wrapper.text()).toContain("Nothing on the list");
  });
});
