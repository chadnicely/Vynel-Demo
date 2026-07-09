import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import CreateScheduleDialog from "./CreateScheduleDialog.vue";
import type { SectionScope } from "./section-scope.js";

function makeHarness(defaultScope: SectionScope = { kind: "global" }) {
  const createCalls: Record<string, unknown>[] = [];
  const client = {
    schedulesUser: {
      create: async (input: Record<string, unknown>) => {
        createCalls.push(input);
        return { id: "s-1" };
      },
    },
    workspaces: {
      list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
    },
  } as unknown as VynelClient;

  const wrapper = mount(CreateScheduleDialog, {
    props: { open: true, defaultScope },
    global: {
      plugins: [
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
  });
  return { wrapper, createCalls };
}

function dialogElement(): HTMLElement {
  // Teleported dialogs accumulate in document.body across a file's tests —
  // the newest mount is the last one.
  const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) throw new Error("dialog did not render");
  return dialog;
}

async function typePrompt(dialog: HTMLElement, text: string) {
  const prompt = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
  prompt.value = text;
  prompt.dispatchEvent(new Event("input"));
  await flushPromises();
}

function clickButton(dialog: HTMLElement, label: string) {
  const button = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button labeled ${label}`);
  button.click();
}

describe("CreateScheduleDialog", () => {
  it("creates a one-time reminder from the 15-minute preset", async () => {
    const { wrapper, createCalls } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();
    await typePrompt(dialog, "Remind me to stretch");

    const before = Date.now();
    clickButton(dialog, "Create schedule");
    await flushPromises();

    expect(createCalls).toHaveLength(1);
    const call = createCalls[0]!;
    expect(call.scope).toBe("global");
    // 'custom' + chat-only on purpose: a one-time schedule still runs a REAL
    // Claude turn ('reminder' delivers text verbatim and demands a channel).
    expect(call.templateKind).toBe("custom");
    expect(call.destinationKind).toBe("chat-only");
    expect(call.promptTemplate).toBe("Remind me to stretch");
    expect(call.cronExpression).toBeUndefined();
    const fireAt = new Date(call.fireAt as string).getTime();
    expect(fireAt).toBeGreaterThan(before + 14 * 60_000);
    expect(fireAt).toBeLessThan(before + 16 * 60_000);
    expect(wrapper.emitted("created")).toHaveLength(1);
  });

  it("creates a weekly custom schedule with the built cron", async () => {
    const { createCalls } = makeHarness({
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();
    const dialog = dialogElement();
    await typePrompt(dialog, "Weekly summary of the workspace");

    clickButton(dialog, "Repeats");
    await flushPromises();
    clickButton(dialog, "Weekly");
    await flushPromises();
    clickButton(dialog, "Fri");
    await flushPromises();
    clickButton(dialog, "Create schedule");
    await flushPromises();

    expect(createCalls).toHaveLength(1);
    const call = createCalls[0]!;
    expect(call.scope).toBe("workspace");
    expect(call.workspaceId).toBe("w1");
    expect(call.templateKind).toBe("custom");
    expect(call.cronExpression).toBe("0 9 * * 5");
    expect(call.fireAt).toBeUndefined();
  });

  it("keeps Create disabled until the prompt is typed", async () => {
    makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    const create = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Create schedule",
    )!;
    expect(create.disabled).toBe(true);
  });
});
