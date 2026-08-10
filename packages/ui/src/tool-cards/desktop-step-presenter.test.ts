import { describe, expect, it } from "vitest";
import {
  describeDesktopStep,
  presentDesktopToolCall,
  selectorDisplayName,
} from "./desktop-step-presenter.js";
import { parseDesktopPlanCard } from "./desktop-plan-card.js";
import { presentToolCall } from "./tool-presenters.js";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";

describe("selectorDisplayName", () => {
  it("pulls the name out of role[name=…] selectors", () => {
    expect(selectorDisplayName('button[name="Save"]')).toBe("Save");
    expect(selectorDisplayName('edit[name="Message #general"]')).toBe("Message #general");
  });

  it("is null for stable-id selectors (ids aren't names)", () => {
    expect(selectorDisplayName('[stable_id="abc123"]')).toBeNull();
  });
});

describe("describeDesktopStep — the overlay's progressive voice", () => {
  it("labels each read tool plainly", () => {
    expect(describeDesktopStep("mcp__desktop__list_open_apps", {})).toBe(
      "Looking at your open apps",
    );
    expect(describeDesktopStep("mcp__desktop__list_desktop_notifications", {})).toBe(
      "Checking your notifications",
    );
    expect(describeDesktopStep("mcp__desktop__snapshot_app", { app: "Discord" })).toBe(
      "Reading Discord",
    );
    expect(describeDesktopStep("mcp__desktop__screenshot_app", { app: "Discord" })).toBe(
      "Taking a look at Discord",
    );
  });

  it("narrates actions with the element name and app", () => {
    expect(
      describeDesktopStep("mcp__desktop__act_on_app", {
        app: "Notepad",
        selector: 'button[name="Save"]',
        action: "press",
      }),
    ).toBe('Pressing "Save" in Notepad');
    expect(
      describeDesktopStep("mcp__desktop__act_on_app", {
        app: "Discord",
        selector: 'edit[name="Search"]',
        action: "type_text",
        value: "hello",
      }),
    ).toBe('Typing into "Search" in Discord');
  });

  it("falls back to the raw selector when the name can't be parsed", () => {
    expect(
      describeDesktopStep("mcp__desktop__act_on_app", {
        app: "Notepad",
        selector: '[stable_id="x9"]',
        action: "press",
      }),
    ).toBe('Pressing [stable_id="x9"] in Notepad');
  });

  it("narrates coordinate actions (act_on_desktop)", () => {
    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", { action: "click", x: 120, y: 340 }),
    ).toBe("Clicking at (120, 340)");
    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", {
        action: "click",
        x: 5,
        y: 6,
        double: true,
        app: "Zoom",
      }),
    ).toBe("Double-clicking at (5, 6) in Zoom");
    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", { action: "type", text: "hello" }),
    ).toBe('Typing "hello"');
    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", { action: "press", keys: "ctrl+c" }),
    ).toBe("Pressing ctrl+c");
    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", { action: "drag", x: 1, y: 2, toX: 9, toY: 9 }),
    ).toBe("Dragging at (1, 2) to (9, 9)");
  });

  it("is null for non-desktop tools (callers keep their own fallback)", () => {
    expect(describeDesktopStep("Read", { file_path: "a.ts" })).toBeNull();
    expect(describeDesktopStep("mcp__vynel__list_workspaces", {})).toBeNull();
  });

  it("narrates a BATCH as one step naming its FIRST and LAST actions", () => {
    // A batch is ONE tool call, but the irreversible action is nearly always
    // the LAST one — a bare "+N more" would hide exactly the step that matters
    // (here: Send). The overlay is the only live surface, so it must name it.
    expect(
      describeDesktopStep("mcp__desktop__act_on_app", {
        app: "Discord",
        actions: [
          { selector: 'edit[name="Message"]', action: "type_text", value: "hi" },
          { selector: 'button[name="Send"]', action: "press" },
        ],
      }),
    ).toBe('Typing into "Message" in Discord, then pressing "Send" in Discord');

    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", {
        app: "Google Chrome",
        actions: [
          { action: "click", x: 100, y: 60 },
          { action: "type", text: "lofi" },
          { action: "press", keys: "enter" },
        ],
      }),
    ).toBe("Clicking at (100, 60) in Google Chrome, +1 more, then pressing enter");
  });

  it("a one-entry batch reads exactly like the single form", () => {
    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", {
        app: "Zoom",
        actions: [{ action: "press", keys: "ctrl+c" }],
      }),
    ).toBe("Pressing ctrl+c");
  });

  it("never names a window the CALL did not use", () => {
    // The server ignores a step-level `app` (the frame comes from the call), so
    // echoing one would put model-controlled text on the trust surface claiming
    // a window that was never targeted.
    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", {
        actions: [
          { action: "click", x: 500, y: 300, app: "Notepad" },
          { action: "press", keys: "enter" },
        ],
      }),
    ).toBe("Clicking at (500, 300), then pressing enter");
  });

  it("treats an all-junk actions array as not-a-batch", () => {
    expect(
      describeDesktopStep("mcp__desktop__act_on_desktop", {
        action: "click",
        x: 1,
        y: 2,
        actions: ["junk"],
      }),
    ).toBe("Clicking at (1, 2)");
  });
});

function desktopCall(toolName: string, toolInput: unknown): ChatToolCallResponse {
  return {
    id: "tc",
    parentMessageId: "m",
    toolUseId: "tu",
    toolName,
    toolInput,
    toolOutput: "ok",
    status: "completed",
    approvalStatus: null,
    isErrorResult: false,
    startedAt: "2026-07-21T10:00:00Z",
    completedAt: null,
  };
}

describe("presentToolCall — the desktop branch", () => {
  it("renders act_on_app as a card action, not a payload pane", () => {
    const presentation = presentToolCall(
      desktopCall("mcp__desktop__act_on_app", {
        app: "Notepad",
        selector: 'button[name="Save"]',
        action: "press",
      }),
    );
    expect(presentation.verb).toBe("Pressed");
    expect(presentation.argument).toBe('"Save" in Notepad');
    expect(presentation.body.kind).toBe("text");
  });

  it("renders snapshot_app as a desktop read", () => {
    const presentation = presentToolCall(
      desktopCall("mcp__desktop__snapshot_app", { app: "Discord" }),
    );
    expect(presentation.verb).toBe("Read");
    expect(presentation.argument).toBe("Discord");
  });

  it("leaves unknown desktop tools to the generic fallback", () => {
    expect(presentDesktopToolCall("mcp__desktop__future_tool", {}, null)).toBeNull();
  });

  it("renders a settled batch as one card naming the action count and app", () => {
    const elementBatch = presentToolCall(
      desktopCall("mcp__desktop__act_on_app", {
        app: "Discord",
        actions: [
          { selector: 'edit[name="Message"]', action: "type_text", value: "hi" },
          { selector: 'button[name="Send"]', action: "press" },
        ],
      }),
    );
    expect(elementBatch.verb).toBe("Ran 2 actions");
    expect(elementBatch.argument).toBe("Discord");

    const coordBatch = presentToolCall(
      desktopCall("mcp__desktop__act_on_desktop", {
        app: "Google Chrome",
        actions: [{ action: "click", x: 1, y: 2 }],
      }),
    );
    expect(coordBatch.verb).toBe("Ran 1 action");
    expect(coordBatch.argument).toBe("Google Chrome");
  });

  it("renders request_desktop_access with the tier in words a person reads", () => {
    const presentation = presentToolCall(
      desktopCall("mcp__desktop__request_desktop_access", {
        app: "Discord",
        tier: "click",
        reason: "Read the #general channel",
      }),
    );
    expect(presentation.verb).toBe("Asked to use");
    expect(presentation.argument).toBe("Discord");
    expect(presentation.subtitle).toBe("look + click");
  });
});

describe("describeDesktopStep — request_desktop_access", () => {
  it("labels the consent moment with app + tier words", () => {
    expect(
      describeDesktopStep("mcp__desktop__request_desktop_access", {
        app: "Discord",
        tier: "full",
      }),
    ).toBe("Asking to use Discord (look, click + type)");
  });
});

const planInput = {
  goal: "Open Chrome and search the latest song on YouTube",
  steps: ["Focus Chrome", "Open youtube.com", "Search"],
  apps: [{ app: "Google Chrome", tier: "full" }],
};

describe("propose_desktop_plan presentation", () => {
  it("narrates the plan proposal with its goal", () => {
    expect(describeDesktopStep("mcp__desktop__propose_desktop_plan", planInput)).toBe(
      "Proposing a plan: Open Chrome and search the latest song on YouTube",
    );
    expect(describeDesktopStep("mcp__desktop__propose_desktop_plan", {})).toBe(
      "Proposing a plan",
    );
  });

  it("renders the settled card with the goal and step count", () => {
    const presentation = presentToolCall(
      desktopCall("mcp__desktop__propose_desktop_plan", planInput),
    );
    expect(presentation.verb).toBe("Proposed a plan");
    expect(presentation.argument).toBe(planInput.goal);
    expect(presentation.subtitle).toBe("3 steps");
  });
});

describe("parseDesktopPlanCard", () => {
  it("parses a plan-shaped input", () => {
    expect(parseDesktopPlanCard(planInput)).toEqual(planInput);
  });

  it("is ALL-OR-NOTHING: one malformed entry rejects the whole parse", () => {
    // Never a cleaned subset — the plan pane must show exactly what an
    // approval can arm; a partial render would under-display the consent.
    expect(
      parseDesktopPlanCard({
        goal: "g",
        steps: ["ok", 42],
        apps: [{ app: "Chrome", tier: "full" }],
      }),
    ).toBeNull();
    expect(
      parseDesktopPlanCard({
        goal: "g",
        steps: ["ok"],
        apps: [{ app: "Chrome", tier: "full" }, { app: "" }],
      }),
    ).toBeNull();
    expect(parseDesktopPlanCard(null)).toBeNull();
    expect(parseDesktopPlanCard({ goal: "g" })).toBeNull();
    expect(parseDesktopPlanCard({ goal: "g", steps: [], apps: [] })).toBeNull();
    expect(parseDesktopPlanCard({ goal: "g", steps: ["s"], apps: [{}] })).toBeNull();
  });
});
