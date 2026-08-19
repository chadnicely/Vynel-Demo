import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import ToolCallCard from "./ToolCallCard.vue";

function makeToolCall(
  overrides: Partial<ChatToolCallResponse> = {},
): ChatToolCallResponse {
  return {
    id: "tc-1",
    parentMessageId: "msg-1",
    toolUseId: "tu-1",
    toolName: "Read",
    toolInput: { file_path: "src/pricing.ts" },
    toolOutput: "export const price = 49",
    status: "completed",
    approvalStatus: null,
    isErrorResult: false,
    startedAt: "2026-07-05T10:00:00.000Z",
    completedAt: "2026-07-05T10:00:01.500Z",
    ...overrides,
  };
}

describe("ToolCallCard", () => {
  it("shows the verb, argument, and duration collapsed — no status word on a clean run", () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall() },
    });

    expect(wrapper.find(".verb").text()).toBe("Read");
    expect(wrapper.find(".argument").text()).toBe("pricing.ts");
    expect(wrapper.text()).toContain("1.5s");
    // A clean completion is told by the dot, not spelled out.
    expect(wrapper.text()).not.toContain("completed");
    expect(wrapper.find(".detail").exists()).toBe(false);
  });

  it("expands a Read into the file-path header and its content", async () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall() },
    });

    await wrapper.find(".summary").trigger("click");

    expect(wrapper.find(".file-path").text()).toBe("src/pricing.ts");
    expect(wrapper.find(".code-block").text()).toContain(
      "export const price = 49",
    );
  });

  it("expands an Edit into a unified diff with ± stats on the chip", async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          toolName: "Edit",
          toolInput: {
            file_path: "site/pricing.md",
            old_string: "Pro — $39/mo",
            new_string: "Pro — $49/mo",
          },
        }),
      },
    });

    expect(wrapper.find(".stat-added").text()).toBe("+1");
    expect(wrapper.find(".stat-removed").text()).toBe("-1");

    await wrapper.find(".summary").trigger("click");

    expect(wrapper.find(".diff-block.is-removed").text()).toContain("$39/mo");
    expect(wrapper.find(".diff-block.is-added").text()).toContain("$49/mo");
  });

  it("expands a Bash into a terminal with prompt and output", async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          toolName: "Bash",
          toolInput: { command: "npm run build" },
          toolOutput: "✓ built in 1.9s",
        }),
      },
    });

    await wrapper.find(".summary").trigger("click");

    expect(wrapper.find(".terminal-command").text()).toContain("npm run build");
    expect(wrapper.find(".terminal-output").text()).toContain(
      "✓ built in 1.9s",
    );
  });

  it("humanizes an MCP tool's name and falls back to COLORED JSON payload panes", async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          toolName: "mcp__vynel__search_knowledge",
          toolInput: { query: "invoices", limit: 3 },
          toolOutput: { hits: 3 },
        }),
      },
    });

    expect(wrapper.find(".verb").text()).toBe("search knowledge");

    await wrapper.find(".summary").trigger("click");

    // Object payloads render through CodeBlock (json) — pretty + colored.
    const payloads = wrapper.findAll(".payload-code");
    expect(payloads).toHaveLength(2);
    expect(payloads[0]!.text()).toContain("invoices");
    expect(payloads[1]!.text()).toContain("hits");
  });

  it("unwraps an MCP text-content result and surfaces its inner JSON, unescaped", async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({
          toolName: "mcp__vynel__send_task_to_workspace",
          toolInput: { task: "audit the docs" },
          toolOutput: [
            { type: "text", text: '{"status":"enqueued","jobId":"job-1"}' },
          ],
        }),
      },
    });

    await wrapper.find(".summary").trigger("click");

    const result = wrapper.findAll(".payload-code")[1]!;
    // The object, not the wrapper array and not the escaped string.
    expect(result.text()).toContain('"status": "enqueued"');
    expect(result.text()).not.toContain("\\");
    expect(result.text()).not.toContain('"type"');
  });

  it("renders a running tool with the live presence pulse", () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: makeToolCall({ status: "started", completedAt: null }),
      },
    });

    expect(wrapper.find(".presence-dot.is-live").exists()).toBe(true);
    expect(wrapper.text()).toContain("running");
  });

  it("marks a denied tool call as an error tone", () => {
    const wrapper = mount(ToolCallCard, {
      props: { toolCall: makeToolCall({ status: "denied" }) },
    });

    expect(wrapper.find(".status-dot.tone-error").exists()).toBe(true);
  });

  // The classifier-deny card: the provider's OWN safety check refused the call
  // before it ran. The line says who + why, and offers the one way forward.
  describe("a BLOCKED tool call", () => {
    const canned =
      "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.";
    function makeBlocked(reason: string | null) {
      return makeToolCall({
        toolName: "Bash",
        toolInput: { command: 'ssh ops@host "crontab -"' },
        toolOutput: { blockedBy: "classifier", reason, message: canned },
        status: "blocked",
        isErrorResult: true,
      });
    }

    it("says it was blocked by Claude's safety check, with the reason, and offers Run it anyway", () => {
      const wrapper = mount(ToolCallCard, {
        props: {
          toolCall: makeBlocked("Writing a remote crontab is irreversible without clear user intent"),
          reauthorizable: true,
        },
      });

      const line = wrapper.get('[data-testid="tool-call-blocked"]');
      expect(line.text()).toContain("Blocked by Claude's safety check");
      expect(line.text()).toContain(
        "Writing a remote crontab is irreversible without clear user intent",
      );
      expect(wrapper.find(".status-dot.tone-error").exists()).toBe(true);
      expect(wrapper.find(".status-text").text()).toBe("blocked");
      const button = line.get(".reauthorize-button");
      expect(button.text()).toBe("Run it anyway");
      expect(button.attributes("disabled")).toBeUndefined();
    });

    it("falls back to a plain sentence when the provider gave no reason", () => {
      const wrapper = mount(ToolCallCard, {
        props: { toolCall: makeBlocked(null), reauthorizable: true },
      });

      expect(wrapper.get('[data-testid="tool-call-blocked"]').text()).toContain(
        "It wasn't sure you meant this — run it anyway if you do.",
      );
    });

    it("emits reauthorize ONCE on click, then hides the button", async () => {
      const wrapper = mount(ToolCallCard, {
        props: { toolCall: makeBlocked("no clear intent"), reauthorizable: true },
      });

      await wrapper.get(".reauthorize-button").trigger("click");

      expect(wrapper.emitted("reauthorize")).toHaveLength(1);
      expect(wrapper.find(".reauthorize-button").exists()).toBe(false);
      // The line itself stays — the refusal is still the record.
      expect(wrapper.find('[data-testid="tool-call-blocked"]').exists()).toBe(true);
    });

    it("keeps the button disabled (and silent) while the host says a turn is streaming", async () => {
      const wrapper = mount(ToolCallCard, {
        props: { toolCall: makeBlocked("no clear intent") },
      });

      const button = wrapper.get(".reauthorize-button");
      expect(button.attributes("disabled")).toBeDefined();
      await button.trigger("click");
      expect(wrapper.emitted("reauthorize")).toBeUndefined();

      await wrapper.setProps({ reauthorizable: true });
      expect(wrapper.get(".reauthorize-button").attributes("disabled")).toBeUndefined();
    });

    it("expanded, the terminal shows what the model got back — not the raw refusal record", async () => {
      const wrapper = mount(ToolCallCard, {
        props: { toolCall: makeBlocked("no clear intent") },
      });

      await wrapper.find(".summary").trigger("click");

      expect(wrapper.find(".terminal-output").text()).toContain(canned);
      expect(wrapper.find(".terminal-output").text()).not.toContain("blockedBy");
    });

    it("never grows the line on a failed call whose output merely looks like the record", () => {
      const wrapper = mount(ToolCallCard, {
        props: {
          toolCall: makeToolCall({
            status: "failed",
            isErrorResult: true,
            toolOutput: { blockedBy: "classifier", reason: "x", message: "y" },
          }),
        },
      });

      expect(wrapper.find('[data-testid="tool-call-blocked"]').exists()).toBe(false);
    });
  });
});
