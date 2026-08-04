// The B5 card component: persona identity renders (monogram fallback), the
// queued/working line, and the Watch/Stop affordances emit.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PersonaLiveCard from "./PersonaLiveCard.vue";
import type { PersonaLiveCardModel } from "../../composables/delegations/use-live-delegation-cards.js";

function makeCard(overrides: Partial<PersonaLiveCardModel> = {}): PersonaLiveCardModel {
  return {
    key: "trace-1",
    partialSessionId: "trace-1",
    persona: {
      name: "Nova",
      imageUrl: null,
      monogram: "N",
      accentVar: "--ws-1",
    },
    taskLabel: "Research WAL mode",
    state: "working",
    acked: false,
    narration: "Read · wal.md",
    recentSteps: [
      { label: "Grep · schema", isRunning: false },
      { label: "Read · wal.md", isRunning: true },
    ],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("PersonaLiveCard", () => {
  it("renders the persona (monogram fallback), task, and narration line", () => {
    const wrapper = mount(PersonaLiveCard, { props: { card: makeCard() } });
    expect(wrapper.get('[data-testid="persona-card-name"]').text()).toBe("Nova");
    expect(wrapper.text()).toContain("N"); // the monogram avatar
    expect(wrapper.text()).toContain("Research WAL mode");
    expect(wrapper.get('[data-testid="persona-card-line"]').text()).toContain("wal.md");
    // The prior step shows as partial activity; the current one lives in the line.
    expect(wrapper.text()).toContain("Grep · schema");
  });

  it("a QUEUED card says so; an acked card wears the badge", () => {
    const queued = mount(PersonaLiveCard, {
      props: { card: makeCard({ state: "queued", narration: null, startedAt: null }) },
    });
    expect(queued.get('[data-testid="persona-card-line"]').text()).toContain("Queued");

    const acked = mount(PersonaLiveCard, {
      props: { card: makeCard({ acked: true }) },
    });
    expect(acked.text()).toContain("acknowledged");
  });

  it("Watch and Stop emit", async () => {
    const wrapper = mount(PersonaLiveCard, { props: { card: makeCard() } });
    await wrapper.get('[data-testid="persona-card-watch"]').trigger("click");
    await wrapper.get('[data-testid="persona-card-stop"]').trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.emitted("stop")).toHaveLength(1);
  });
});
