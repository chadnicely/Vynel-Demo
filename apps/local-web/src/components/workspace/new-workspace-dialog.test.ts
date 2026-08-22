// The fork before any workspace is added — two real doors, each a genuinely
// different journey, and nothing that does not exist yet.

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

describe("NewWorkspaceDialog", () => {
  it("offers the two doors that exist — the wizard and a folder — and nothing dead", async () => {
    await mountDialog();
    const text = document.body.textContent ?? "";
    expect(text).toContain("What are we adding?");
    expect(text).toContain("Walk me through it");
    expect(text).toContain("Pull from a folder");
    expect(text).toContain("nothing gets moved");
    expect(document.body.querySelectorAll("button.door")).toHaveLength(2);
    expect(text).not.toContain("repository");
  });

  it("each door reports its pick", async () => {
    const wrapper = await mountDialog();
    door("wizard").click();
    await flushPromises();
    door("folder").click();
    await flushPromises();
    expect(wrapper.emitted("pick")).toEqual([["wizard"], ["folder"]]);
  });
});
