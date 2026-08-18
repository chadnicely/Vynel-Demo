// The detail read's `continuing` mode: the chain transcript — or, before the
// primary's first turn is bridged (transcript with `session: null`), the
// running segment the caller resolved from the activity feed. Without the
// fallback a fresh workspace's first turn showed the welcome hero in every
// window but the sender's until it ended.

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useSessionDetail } from "./use-session-detail.js";

function mountDetail(client: unknown, mode: "continuing" | "segment", sessionId: string | null) {
  let query!: ReturnType<typeof useSessionDetail>;
  const Host = defineComponent({
    setup() {
      query = useSessionDetail(
        () => ({ kind: "workspace", workspaceId: "ws-1" }),
        () => sessionId,
        () => false,
        () => mode,
      );
      return () => h("div");
    },
  });
  const wrapper = mount(Host, {
    global: {
      plugins: [
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return { wrapper, query: () => query };
}

describe("useSessionDetail — continuing mode", () => {
  it("returns the chain transcript when the primary has a head", async () => {
    const transcript = { session: { id: "head" }, messages: [{ id: "m1" }], toolCallsByMessageId: {} };
    const client = {
      chat: {
        getContinuingTranscript: vi.fn(async () => transcript),
        getSession: vi.fn(),
      },
    };
    const { wrapper, query } = mountDetail(client, "continuing", "head");
    await vi.waitFor(() => expect(query().data.value).toEqual(transcript));
    expect(client.chat.getContinuingTranscript).toHaveBeenCalledWith("ws-1");
    expect(client.chat.getSession).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("falls back to the running segment while the primary is unbridged (transcript session null)", async () => {
    const segment = { session: { id: "first-turn" }, messages: [{ id: "u1" }, { id: "a1" }], toolCallsByMessageId: {} };
    const client = {
      chat: {
        getContinuingTranscript: vi.fn(async () => ({ session: null, messages: [], toolCallsByMessageId: {} })),
        getSession: vi.fn(async () => segment),
      },
    };
    const { wrapper, query } = mountDetail(client, "continuing", "first-turn");
    await vi.waitFor(() => expect(query().data.value).toEqual(segment));
    expect(client.chat.getSession).toHaveBeenCalledWith("ws-1", "first-turn");
    wrapper.unmount();
  });

  it("stays disabled with no session id", async () => {
    const client = { chat: { getContinuingTranscript: vi.fn(), getSession: vi.fn() } };
    const { wrapper, query } = mountDetail(client, "continuing", null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(query().data.value).toBeUndefined();
    expect(client.chat.getContinuingTranscript).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
