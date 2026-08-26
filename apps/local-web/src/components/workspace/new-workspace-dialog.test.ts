// The fork before any project is added — TWO short questions, not one long
// one (Chad, 2026-08-24). Someone starting fresh is never shown the two
// answers that are not about them.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import NewWorkspaceDialog from "./NewWorkspaceDialog.vue";

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
});

async function mountDialog() {
  const wrapper = mount(NewWorkspaceDialog, { props: { open: true } });
  await flushPromises();
  activeWrapper = wrapper;
  return wrapper;
}

function door(pick: string): HTMLButtonElement {
  const match = document.body.querySelector<HTMLButtonElement>(
    `button.door[data-pick="${pick}"]`,
  );
  if (!match) throw new Error(`no door ${pick}`);
  return match;
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

describe("NewWorkspaceDialog", () => {
  it("asks the top question first — new, or something you already have", async () => {
    await mountDialog();

    expect(bodyText()).toContain("What are we adding?");
    expect(bodyText()).toContain("Start something new");
    expect(bodyText()).toContain("Bring in what you have");
    expect(document.body.querySelectorAll("button.door")).toHaveLength(2);

    // The WHERE answers belong to the second question — not this one.
    expect(bodyText()).not.toContain("Pull from a folder");
    expect(bodyText()).not.toContain("Clone from a git address");
    // Nothing dead: Quick Create does not exist yet.
    expect(bodyText()).not.toContain("Set it up instantly");
  });

  it("something new goes straight to the wizard — no second question", async () => {
    const wrapper = await mountDialog();

    door("wizard").click();
    await flushPromises();

    expect(wrapper.emitted("pick")).toEqual([["wizard"]]);
  });

  it("bringing something in asks WHERE, then reports the pick", async () => {
    const wrapper = await mountDialog();

    door("stage:existing").click();
    await flushPromises();

    expect(bodyText()).toContain("Where is it now?");
    expect(bodyText()).toContain("Pull from a folder");
    expect(bodyText()).toContain("Create local from a repository");
    // Choosing the fork is NOT a pick — nothing is opened behind it yet.
    expect(wrapper.emitted("pick")).toBeUndefined();

    door("folder").click();
    await flushPromises();
    expect(wrapper.emitted("pick")).toEqual([["folder"]]);
  });

  it("Back returns to the top question", async () => {
    const wrapper = await mountDialog();

    door("stage:existing").click();
    await flushPromises();
    const back = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Back"),
    );
    back?.click();
    await flushPromises();

    expect(bodyText()).toContain("What are we adding?");
    expect(wrapper.emitted("pick")).toBeUndefined();
  });

  it("re-opening starts at the top question, never mid-fork", async () => {
    const wrapper = await mountDialog();

    door("stage:existing").click();
    await flushPromises();
    expect(bodyText()).toContain("Where is it now?");

    await wrapper.setProps({ open: false });
    await flushPromises();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(bodyText()).toContain("What are we adding?");
  });

  it("the repository door reports its pick", async () => {
    const wrapper = await mountDialog();

    door("stage:existing").click();
    await flushPromises();
    door("clone").click();
    await flushPromises();

    expect(wrapper.emitted("pick")).toEqual([["clone"]]);
  });
});
