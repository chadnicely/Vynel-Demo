// The per-tool edit dialog. Guards the FULL-REPLACE save semantics: a
// pristine tool seeds fully inheriting and sends null for every untouched
// field; a customized tool seeds fully pinned so a save can't silently hand
// untouched fields back to the defaults (the wire carries only hasOverride,
// not which fields the override covers).

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../../plugins/vynel-client.js";
import type { EffectiveToolPolicy } from "../../../composables/tool-policies/tool-policy-contract.js";
import ToolPolicyEditDialog from "./ToolPolicyEditDialog.vue";

function makeTool(
  overrides: Partial<EffectiveToolPolicy> = {},
): EffectiveToolPolicy {
  return {
    toolName: "mcp__desktop__screenshot",
    serverName: "desktop",
    enabled: true,
    surfaces: ["workspace-interactive", "agent"],
    cardClass: "never",
    hasOverride: false,
    ...overrides,
  };
}

function makeHarness(tool: EffectiveToolPolicy) {
  const save = vi.fn(async (_toolName: string, _body: unknown) => tool);
  const client = {
    toolPolicies: { save },
  } as unknown as VynelClient;

  const wrapper = mount(ToolPolicyEditDialog, {
    props: { open: true, tool },
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
  return { wrapper, save };
}

function dialogElement(): HTMLElement {
  const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) throw new Error("dialog did not render");
  return dialog;
}

async function setInherit(
  dialog: HTMLElement,
  fieldClass: string,
  checked: boolean,
) {
  const checkbox = dialog.querySelector<HTMLInputElement>(
    `.${fieldClass} .inherit-checkbox`,
  );
  if (!checkbox) throw new Error(`no inherit checkbox in .${fieldClass}`);
  checkbox.checked = checked;
  checkbox.dispatchEvent(new Event("change"));
  await flushPromises();
}

async function clickButton(dialog: HTMLElement, label: string) {
  const button = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent?.trim().startsWith(label),
  );
  if (!button) throw new Error(`no button labeled ${label}`);
  button.click();
  await flushPromises();
}

describe("ToolPolicyEditDialog — inherit semantics", () => {
  it("a pristine tool sends null for every field the user leaves inheriting", async () => {
    const { wrapper, save } = makeHarness(makeTool());
    await flushPromises();
    const dialog = dialogElement();

    await setInherit(dialog, "field-enabled", false);
    await clickButton(dialog, "On");
    await clickButton(dialog, "Save policy");

    expect(save).toHaveBeenCalledWith("mcp__desktop__screenshot", {
      enabled: false,
      cardClass: null,
      surfaces: null,
      featureKey: null,
      capabilityId: null,
    });
    wrapper.unmount();
  });

  it("a customized tool seeds fully pinned — saving re-declares every effective value", async () => {
    const { wrapper, save } = makeHarness(
      makeTool({
        toolName: "mcp__vynel__memory_save",
        serverName: "vynel",
        surfaces: ["global-interactive"],
        cardClass: "ask",
        featureKey: "memory",
        capabilityId: "memory",
        hasOverride: true,
      }),
    );
    await flushPromises();
    const dialog = dialogElement();

    await clickButton(dialog, "Save policy");

    expect(save).toHaveBeenCalledWith("mcp__vynel__memory_save", {
      enabled: true,
      cardClass: "ask",
      surfaces: ["global-interactive"],
      featureKey: "memory",
      capabilityId: "memory",
    });
    wrapper.unmount();
  });

  it("surface chips edit membership once Surfaces stops inheriting", async () => {
    const { wrapper, save } = makeHarness(makeTool());
    await flushPromises();
    const dialog = dialogElement();

    await setInherit(dialog, "field-surfaces", false);
    await clickButton(dialog, "Agents");
    await clickButton(dialog, "Save policy");

    expect(save).toHaveBeenCalledWith("mcp__desktop__screenshot", {
      enabled: null,
      cardClass: null,
      surfaces: ["workspace-interactive"],
      featureKey: null,
      capabilityId: null,
    });
    wrapper.unmount();
  });
});
