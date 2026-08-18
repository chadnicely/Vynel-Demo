import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import type { AskRequestResponse } from "@vynel/contracts/asks/ask-http";
import AskWizardDialog from "./AskWizardDialog.vue";

const ASK: AskRequestResponse = {
  id: "ask-1",
  userId: "u1",
  workspaceId: null,
  sessionId: null,
  taskId: null,
  questions: [
    {
      id: "project-name",
      label: "What should we call the project?",
      type: "text",
      placeholder: "e.g. Spring launch",
    },
    { id: "wants-updates", label: "Want a note when it's done?", type: "yes-no" },
    {
      id: "update-channels",
      label: "Where should updates go?",
      type: "multi-choice",
      options: ["Email", "Telegram", "Chat"],
      required: false,
    },
  ],
  answers: null,
  status: "pending",
  createdAt: "2026-07-17T10:00:00.000Z",
  resolvedAt: null,
};

function makeHarness(options: { answerFails?: boolean } = {}) {
  const answerCalls: { askId: string; input: Record<string, unknown> }[] = [];
  const dismissCalls: string[] = [];
  const client = {
    asks: {
      answer: async (askId: string, input: Record<string, unknown>) => {
        if (options.answerFails)
          throw new Error("Those answers don't fit the form.");
        answerCalls.push({ askId, input });
        return { ...ASK, status: "answered" };
      },
      dismiss: async (askId: string) => {
        dismissCalls.push(askId);
        return { ...ASK, status: "dismissed" };
      },
    },
  } as unknown as VynelClient;

  const wrapper = mount(AskWizardDialog, {
    props: { open: true, ask: ASK },
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
  return { wrapper, answerCalls, dismissCalls };
}

function dialogElement(): HTMLElement {
  // Teleported dialogs accumulate in document.body across a file's tests —
  // the newest mount is the last one.
  const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) throw new Error("dialog did not render");
  return dialog;
}

function findButton(dialog: HTMLElement, label: string): HTMLButtonElement {
  const button = [...dialog.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button labeled ${label}`);
  return button;
}

async function typeText(dialog: HTMLElement, text: string) {
  const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
}

async function click(dialog: HTMLElement, label: string) {
  findButton(dialog, label).click();
  await flushPromises();
}

describe("AskWizardDialog", () => {
  it("keeps Next disabled until the required question has an answer", async () => {
    makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    expect(dialog.textContent).toContain("Question 1 of 3");
    expect(findButton(dialog, "Next").disabled).toBe(true);

    await typeText(dialog, "Atlas");
    expect(findButton(dialog, "Next").disabled).toBe(false);
  });

  it("steps through the wizard and sends typed answer shapes", async () => {
    const { wrapper, answerCalls } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await typeText(dialog, "Atlas");
    await click(dialog, "Next");
    expect(dialog.textContent).toContain("Want a note when it's done?");

    await click(dialog, "No");
    await click(dialog, "Next");
    expect(dialog.textContent).toContain("Where should updates go?");

    const boxes = dialog.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    boxes[0]!.click();
    // Let the draft round-trip back into props before the next toggle reads it.
    await flushPromises();
    boxes[2]!.click();
    await flushPromises();

    await click(dialog, "Send answers");

    expect(answerCalls).toHaveLength(1);
    expect(answerCalls[0]!.askId).toBe("ask-1");
    expect(answerCalls[0]!.input).toEqual({
      answers: {
        "project-name": "Atlas",
        "wants-updates": false,
        "update-channels": ["Email", "Chat"],
      },
    });
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("sends only answered keys — an untouched optional question stays out", async () => {
    const { answerCalls } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await typeText(dialog, "Atlas");
    await click(dialog, "Next");
    await click(dialog, "Yes");
    await click(dialog, "Next");
    await click(dialog, "Send answers");

    expect(answerCalls).toHaveLength(1);
    expect(answerCalls[0]!.input).toEqual({
      answers: { "project-name": "Atlas", "wants-updates": true },
    });
  });

  it("View as form shows every question and preserves typed values", async () => {
    makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await typeText(dialog, "Atlas");
    await click(dialog, "View as form");

    expect(dialog.textContent).toContain("What should we call the project?");
    expect(dialog.textContent).toContain("Want a note when it's done?");
    expect(dialog.textContent).toContain("Where should updates go?");
    expect(
      dialog.querySelector<HTMLInputElement>('input[type="text"]')!.value,
    ).toBe("Atlas");
  });

  it("surfaces the server's plain-language message when answers are rejected", async () => {
    const { wrapper } = makeHarness({ answerFails: true });
    await flushPromises();
    const dialog = dialogElement();

    await typeText(dialog, "Atlas");
    await click(dialog, "Next");
    await click(dialog, "Yes");
    await click(dialog, "Next");
    await click(dialog, "Send answers");

    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      "Those answers don't fit the form.",
    );
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("I'll decide later dismisses the ask and closes", async () => {
    const { wrapper, dismissCalls } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await click(dialog, "I'll decide later");

    expect(dismissCalls).toEqual(["ask-1"]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
