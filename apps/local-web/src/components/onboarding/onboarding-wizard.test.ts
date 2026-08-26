import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import OnboardingWizard from "./OnboardingWizard.vue";

const STEPS = [
  "welcome",
  "profile",
  "identity-seed",
  "connect-brain",
  "github-backup",
] as const;

const LABELS: Record<(typeof STEPS)[number], string> = {
  welcome: "Hello — welcome to Vynel",
  profile: "Your profile",
  "identity-seed": "Help Vynel know you",
  "connect-brain": "Connect a brain",
  "github-backup": "A safe copy on GitHub",
};

// A stateful five-step onboarding fake: the wizard only reads the wire
// shapes, so a trimmed snapshot is enough. The brain + GitHub steps read the
// sign-in state through the same client, so those doors are faked too.
function makeOnboardingFake(options: { claudeConnected?: boolean } = {}) {
  const claudeConnected = options.claudeConnected ?? true;
  let completedCount = 0;
  let status: "in-progress" | "completed" = "in-progress";
  const submitCalls: Array<{
    runId: string;
    stepKind: string;
    stepInput: unknown;
  }> = [];
  let profileName: string | null = null;

  const currentKind = () =>
    STEPS[Math.min(completedCount, STEPS.length - 1)] as (typeof STEPS)[number];
  const run = () => ({
    id: "run-1",
    userId: "user-1",
    workspaceId: null,
    currentStepKind: currentKind(),
    completedSteps: STEPS.slice(0, completedCount),
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
          order: Math.min(completedCount + 1, STEPS.length),
          isSkippable: currentKind() === "github-backup",
          displayLabel: LABELS[currentKind()],
          oneLineDescription: "One line about this step.",
        },
        totalSteps: STEPS.length,
        completedStepCount: completedCount,
        collectedData: profileName ? { profile: { displayName: profileName } } : {},
      }),
      submitStep: async (
        runId: string,
        body: { stepKind: string; stepInput: unknown },
      ) => {
        submitCalls.push({ runId, ...body });
        if (body.stepKind === "profile") {
          profileName = (body.stepInput as { displayName: string }).displayName;
        }
        completedCount += 1;
        if (completedCount >= STEPS.length) status = "completed";
        return run();
      },
    },
    providers: {
      getAuthStatus: async () => ({
        providerId: "claude",
        isInstalled: true,
        isAuthenticated: claudeConnected,
        authenticatedAccountLabel: claudeConnected ? "chad@example.com" : null,
      }),
    },
    github: {
      getConnection: async () => ({
        isInstalled: true,
        isAuthenticated: false,
        accountLabel: null,
      }),
    },
  } as unknown as VynelClient;

  return { client, submitCalls };
}

async function mountWizard(options: { claudeConnected?: boolean } = {}) {
  const fake = makeOnboardingFake(options);
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

async function submitForm(wrapper: ReturnType<typeof mount>) {
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

async function walkToBrain(wrapper: ReturnType<typeof mount>) {
  await submitForm(wrapper); // welcome
  await wrapper.find('input[type="text"]').setValue("Chad");
  await submitForm(wrapper); // profile
  const answers = wrapper.findAll("textarea");
  await answers[0]!.setValue("I run a bakery.");
  await answers[1]!.setValue("Invoices and supplier emails.");
  await submitForm(wrapper); // identity-seed
}

describe("OnboardingWizard", () => {
  it("starts (or resumes) the run and renders the current step from the snapshot", async () => {
    const { wrapper } = await mountWizard();

    expect(wrapper.text()).toContain("Hello — welcome to Vynel");
    expect(wrapper.text()).toContain("Step 1 of 5");
    expect(wrapper.text()).toContain("Your projects stay where they are");
  });

  it("submits the welcome acknowledgement and advances to the profile", async () => {
    const { wrapper, submitCalls } = await mountWizard();

    await submitForm(wrapper);

    expect(submitCalls).toEqual([
      { runId: "run-1", stepKind: "welcome", stepInput: { acknowledged: true } },
    ]);
    expect(wrapper.text()).toContain("Your profile");
  });

  it("walks profile → Help Vynel know you → Connect a brain, sending each step's input", async () => {
    const { wrapper, submitCalls } = await mountWizard();

    await walkToBrain(wrapper);

    expect(submitCalls.map((call) => call.stepKind)).toEqual([
      "welcome",
      "profile",
      "identity-seed",
    ]);
    expect(submitCalls[2]!.stepInput).toEqual({
      aboutYouParagraph: "I run a bakery.",
      workspaceContextAnswer: "Invoices and supplier emails.",
    });
    expect(wrapper.text()).toContain("Connect a brain");
    expect(wrapper.text()).toContain("chad@example.com");
    expect(wrapper.text()).toContain("Not yet");
  });

  it("holds the brain step until Claude is signed in — the primary stays disabled", async () => {
    const { wrapper } = await mountWizard({ claudeConnected: false });

    await walkToBrain(wrapper);

    expect(wrapper.text()).toContain(
      "Sign in to Claude to carry on — Vynel can't build without a brain.",
    );
    const primary = wrapper.find('button[type="submit"]');
    expect(primary.text()).toBe("Use Claude");
    expect(primary.attributes("disabled")).toBeDefined();
  });

  it("lets the GitHub copy be skipped, celebrates, then asks the one question and emits the door", async () => {
    const { wrapper, submitCalls } = await mountWizard();

    await walkToBrain(wrapper);
    await submitForm(wrapper); // connect-brain → Use Claude
    expect(wrapper.text()).toContain("A safe copy on GitHub");
    expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeDefined();

    await wrapper.find(".skip").trigger("click"); // github-backup → skipped
    await flushPromises();

    expect(submitCalls.map((call) => call.stepKind)).toEqual([...STEPS]);
    expect(submitCalls[3]!.stepInput).toEqual({ providerId: "claude" });
    expect(submitCalls[4]!.stepInput).toEqual({ kind: "skipped" });

    expect(wrapper.text()).toContain("Congratulations, Chad!");
    expect(wrapper.findComponent({ name: "WizardFireworks" }).exists()).toBe(true);

    await wrapper.find(".open-app").trigger("click");
    expect(wrapper.text()).toContain("What are we starting with?");
    // The celebration stops the moment the card becomes a question.
    expect(wrapper.findComponent({ name: "WizardFireworks" }).exists()).toBe(false);

    await wrapper.findAll(".door")[1]!.trigger("click");
    expect(wrapper.emitted("completed")).toEqual([["existing"]]);
  });
});
