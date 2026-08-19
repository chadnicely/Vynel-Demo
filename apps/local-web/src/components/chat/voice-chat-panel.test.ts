// The Voice chat panel's SETTINGS ENVELOPE (session-hardening D2): the spoken
// thread runs one tier on every leg, so a typed message here must carry the
// same model / effort / hands-free mode a spoken one does, and the composer
// must neither offer a change nor write one. Before this, the panel handed the
// composer the voice segment's id: the chips PATCHed a row no voice turn ever
// reads, and a typed turn ran the CHAT mode while the spoken one ran the tier.

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  VOICE_TIER_MODEL,
  VOICE_TIER_MODE,
  VOICE_TIER_THINKING_EFFORT,
} from "@vynel/contracts/chat/voice-tier";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityStore } from "../../stores/activity-store.js";
import VoiceChatPanel from "./VoiceChatPanel.vue";

// A stand-in for the real composer: it only has to record what the panel
// handed it and be able to fire a send.
const ComposerStub = defineComponent({
  name: "AppComposer",
  props: {
    sessionId: { type: [String, null], default: undefined },
    settingsLocked: { type: Boolean, default: false },
    settingsLockedNote: { type: [String, null], default: null },
    settingsDefaults: { type: Object, default: undefined },
    streaming: { type: Boolean, default: false },
    placeholder: { type: String, default: undefined },
    destinationLabel: { type: [String, null], default: null },
  },
  emits: ["send", "interrupt"],
  setup: () => () => h("div", { class: "composer-stub" }),
});

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});

function mountPanel() {
  const POST = vi.fn(async () => ({
    data: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    response: { ok: true, status: 200 },
  }));
  const updateSettings = vi.fn(async () => ({
    sessionMode: null,
    selectedModel: null,
    thinkingEffort: null,
    autoBuildout: null,
  }));
  const client = {
    POST,
    chat: { interruptSession: vi.fn(async () => undefined) },
    approvals: { decide: vi.fn(async () => undefined) },
    sessions: {
      updateSettings,
      getSettings: vi.fn(async () => ({
        sessionMode: null,
        selectedModel: null,
        thinkingEffort: null,
        autoBuildout: null,
      })),
    },
    root: {
      getVoiceTranscript: vi.fn(async () => ({
        messages: [],
        session: null,
        toolCallsByMessageId: {},
      })),
    },
  } as never;

  wrapper = mount(VoiceChatPanel, {
    global: {
      plugins: [
        createPinia(),
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
      stubs: {
        AppComposer: ComposerStub,
        ThreadStream: true,
        QueuedMessageChips: true,
        ThreadSkeleton: true,
        EmptyState: true,
        PresenceDot: true,
      },
    },
  });
  return { POST, updateSettings, composer: () => wrapper!.findComponent(ComposerStub) };
}

describe("VoiceChatPanel — the hands-free settings envelope", () => {
  it("locks the composer and gives it NO session id, so nothing can PATCH the voice row", () => {
    const { updateSettings, composer } = mountPanel();
    expect(composer().props("settingsLocked")).toBe(true);
    // No session id ⇒ the composer never reads or writes the voice row.
    expect(composer().props("sessionId")).toBeUndefined();
    expect(composer().props("settingsLockedNote")).toContain("Hands-free");
    // The chips SHOW the tier (the surface defaults the composer renders).
    expect(composer().props("settingsDefaults")).toMatchObject({
      modelId: VOICE_TIER_MODEL,
      mode: VOICE_TIER_MODE,
      thinkingEffort: VOICE_TIER_THINKING_EFFORT,
    });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("a typed message carries the voice tier — model, effort, hands-free mode, voice:true", async () => {
    const { POST, updateSettings, composer } = mountPanel();
    // Whatever the composer emits, the panel sends the tier.
    composer().vm.$emit("send", "how is the build going", [], {
      modelId: "claude-opus-4-8",
      mode: "ask",
      thinkingEffort: "max",
      autoBuildout: true,
    });
    await vi.waitFor(() => expect(POST).toHaveBeenCalled());

    const [path, init] = POST.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(path).toBe("/root/turn");
    expect(init.body).toMatchObject({
      userMessageText: "how is the build going",
      model: VOICE_TIER_MODEL,
      mode: VOICE_TIER_MODE,
      thinkingEffort: VOICE_TIER_THINKING_EFFORT,
      voice: true,
    });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("recognises a running turn by scopeKind 'voice' — never by a global one", async () => {
    mountPanel();
    const activity = useActivityStore();
    // Let the (empty) transcript settle so the panel is past its skeleton and
    // the running-turn signal is the only thing left deciding what it shows.
    await vi.waitFor(() =>
      expect(wrapper!.findComponent({ name: "EmptyState" }).exists()).toBe(true),
    );
    const baseTurn = {
      turnId: "t-1",
      workspaceId: null,
      sessionId: null,
      startedAt: "2026-08-19T00:00:00.000Z",
    };
    // A GLOBAL turn — even one the feed labels as voice-originated — is not
    // this thread: identity is the scope, never an origin label or an absence.
    activity.serverTurns = {
      "t-1": { ...baseTurn, scopeKind: "global", origin: "voice" },
    } as never;
    await wrapper!.vm.$nextTick();
    expect(wrapper!.findComponent({ name: "EmptyState" }).exists()).toBe(true);

    activity.serverTurns = {
      "t-1": { ...baseTurn, scopeKind: "voice", origin: "voice" },
    } as never;
    await wrapper!.vm.$nextTick();
    // Its OWN turn is running — the panel stops claiming nothing was spoken.
    expect(wrapper!.findComponent({ name: "EmptyState" }).exists()).toBe(false);
  });
});
