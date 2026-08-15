import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import WorkspaceWelcomeHero from "./WorkspaceWelcomeHero.vue";

function makeWorkspace(
  overrides: Partial<WorkspaceResponse> = {},
): WorkspaceResponse {
  return {
    id: "w1",
    userId: "u1",
    name: "vynel",
    managerName: "Ava",
    kind: "project",
    path: "E:/spaces/vynel",
    isArchived: false,
    continueEnabled: true,
    groupId: null,
    status: null,
    statusNote: null,
    statusSetAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    lastAccessedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("WorkspaceWelcomeHero", () => {
  it("presents the manager persona on the workspace, wearing its monogram + accent", () => {
    const wrapper = mount(WorkspaceWelcomeHero, {
      props: { workspace: makeWorkspace() },
    });

    expect(wrapper.find(".mark-initial").text()).toBe("VY");
    expect(wrapper.find(".hero-wordmark").text()).toBe("vynel");
    expect(wrapper.find(".hero-greeting").text()).toBe("Ava is on vynel.");
    expect(wrapper.find(".workspace-hero").attributes("style")).toContain(
      "--accent",
    );
  });

  it("welcomes without a persona, still wearing the room's monogram", () => {
    const wrapper = mount(WorkspaceWelcomeHero, {
      props: { workspace: makeWorkspace({ managerName: null, name: "blog" }) },
    });

    expect(wrapper.find(".mark-initial").text()).toBe("BL");
    expect(wrapper.find(".hero-greeting").text()).toBe("Welcome to blog.");
  });

  it("names the workspace kind in the hero line", () => {
    const wrapper = mount(WorkspaceWelcomeHero, {
      props: { workspace: makeWorkspace({ kind: "personal" }) },
    });

    expect(wrapper.text()).toContain("Personal workspace");
  });
});
