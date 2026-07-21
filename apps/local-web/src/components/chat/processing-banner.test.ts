import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ProcessingBanner from "./ProcessingBanner.vue";
import type { InFlightDelegationChip } from "./ProcessingBanner.vue";

function makeDelegation(
  overrides: Partial<InFlightDelegationChip> = {},
): InFlightDelegationChip {
  return {
    partialSessionId: "partial-1",
    workspaceName: "Acme",
    sessionName: null,
    taskLabel: "Set up the login page",
    ...overrides,
  };
}

function mountBanner(
  delegations: InFlightDelegationChip[],
  backgroundTurnLabel: string | null = null,
) {
  return mount(ProcessingBanner, {
    props: { delegations, backgroundTurnLabel },
  });
}

describe("ProcessingBanner", () => {
  it("renders nothing while idle", () => {
    const wrapper = mountBanner([]);
    expect(wrapper.find(".processing-banner").exists()).toBe(false);
  });

  it("labels a workspace-target chip by the workspace + task, and Watch emits its trace key", async () => {
    const wrapper = mountBanner([makeDelegation()]);

    const chip = wrapper.get(".processing-chip-main");
    expect(chip.text()).toContain("Acme · Set up the login page");
    await chip.trigger("click");
    expect(wrapper.emitted("watch")).toEqual([["partial-1"]]);
  });

  it("labels a SESSION-target chip by the session's name; Watch still opens the trace (Slice ④)", async () => {
    // The trace is keyed by partialSessionId regardless of target kind — a
    // session-target job's chip opens the same panel a workspace one does.
    const wrapper = mountBanner([
      makeDelegation({
        partialSessionId: "partial-2",
        workspaceName: "Session",
        sessionName: "Research: pricing",
        taskLabel: "compare the pages",
      }),
    ]);

    const chip = wrapper.get(".processing-chip-main");
    expect(chip.text()).toContain("Research: pricing · compare the pages");
    expect(chip.text()).not.toContain("Session ·");
    await chip.trigger("click");
    expect(wrapper.emitted("watch")).toEqual([["partial-2"]]);
  });

  it("Stop emits the delegation's trace key", async () => {
    const wrapper = mountBanner([makeDelegation()]);
    await wrapper.get(".processing-chip-stop").trigger("click");
    expect(wrapper.emitted("stop")).toEqual([["partial-1"]]);
  });

  it("a keyless job still counts as live work — a static chip, no Watch", () => {
    const wrapper = mountBanner([
      makeDelegation({ partialSessionId: null, taskLabel: "" }),
    ]);
    expect(wrapper.find(".processing-chip-main").exists()).toBe(false);
    expect(wrapper.get(".processing-chip").text()).toContain("Working in Acme…");
  });

  it("shows the background-turn origin note beside the chips", () => {
    const wrapper = mountBanner([makeDelegation()], "Replying on Telegram…");
    expect(wrapper.text()).toContain("Replying on Telegram…");
    expect(wrapper.findAll(".processing-chip")).toHaveLength(2);
  });
});
