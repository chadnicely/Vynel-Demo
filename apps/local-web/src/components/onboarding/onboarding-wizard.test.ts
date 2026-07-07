import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import OnboardingWizard from "./OnboardingWizard.vue";

// A stateful two-step onboarding fake: welcome → profile → completed. The
// wizard only reads the wire shapes, so a trimmed snapshot is enough.
function makeOnboardingFake() {
  const steps = ["welcome", "profile"] as const;
  let completedCount = 0;
  let status: "in-progress" | "completed" = "in-progress";
  const submitCalls: Array<{
    runId: string;
    stepKind: string;
    stepInput: unknown;
  }> = [];

  const currentKind = () =>
    steps[Math.min(completedCount, steps.length - 1)] as string;
  const run = () => ({
    id: "run-1",
    userId: "user-1",
    workspaceId: null,
    currentStepKind: currentKind(),
    completedSteps: steps.slice(0, completedCount),
    collectedData: {},
    status,
    startedAt: "2026-07-07T00:00:00.000Z",
    lastActivityAt: "2026-07-07T00:00:00.000Z",
    completedAt: null,
  });

  const client = {
    onboarding: {
      start: async () => run(),
      restart: async () => {
        completedCount = 0;
        status = "in-progress";
        return run();
      },
      getRunStatus: async () => ({
        run: run(),
        currentStep: {
          stepKind: currentKind(),
          order: Math.min(completedCount + 1, steps.length),
          isSkippable: false,
          displayLabel: `The ${currentKind()} step`,
          oneLineDescription: "One line about this step.",
        },
        totalSteps: steps.length,
        completedStepCount: completedCount,
        collectedData: {},
      }),
      submitStep: async (
        runId: string,
        body: { stepKind: string; stepInput: unknown },
      ) => {
        submitCalls.push({ runId, ...body });
        completedCount += 1;
        if (completedCount >= steps.length) status = "completed";
        return run();
      },
    },
  } as unknown as VynelClient;

  return { client, submitCalls };
}

async function mountWizard() {
  const fake = makeOnboardingFake();
  const wrapper = mount(OnboardingWizard, {
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
      provide: { [vynelClientKey as symbol]: fake.client },
    },
  });
  await flushPromises();
  return { wrapper, ...fake };
}

describe("OnboardingWizard", () => {
  it("starts (or resumes) the run and renders the current step from the snapshot", async () => {
    const { wrapper } = await mountWizard();

    expect(wrapper.text()).toContain("The welcome step");
    expect(wrapper.text()).toContain("Step 1 of 2");
  });

  it("submits the welcome acknowledgement and advances to the next step", async () => {
    const { wrapper, submitCalls } = await mountWizard();

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(submitCalls).toEqual([
      {
        runId: "run-1",
        stepKind: "welcome",
        stepInput: { acknowledged: true },
      },
    ]);
    expect(wrapper.text()).toContain("The profile step");
  });

  it("shows the done screen after the last step and emits completed on open", async () => {
    const { wrapper } = await mountWizard();

    await wrapper.find("form").trigger("submit"); // welcome
    await flushPromises();
    await wrapper.find('input[type="text"]').setValue("Chad");
    await wrapper.find("form").trigger("submit"); // profile
    await flushPromises();

    expect(wrapper.text()).toContain("You're all set");
    await wrapper.find(".open-app").trigger("click");
    expect(wrapper.emitted("completed")).toHaveLength(1);
  });
});
