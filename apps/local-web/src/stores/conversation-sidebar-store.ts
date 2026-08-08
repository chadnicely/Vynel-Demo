import { computed, ref } from "vue";
import { defineStore } from "pinia";

// The app sidebar (live-tracking redesign, Case 1): the pointer's landing — a
// docked right panel showing the REAL conversation of whoever is working. One
// unified flow, no tabs, no derived views. ONE node at a time: every open
// REPLACES the panel, including a pointer clicked INSIDE it — forward-only
// hops, no back stack (Chad, 2026-08-09: navigation stays a pointer, easy to
// follow here to there).
export type SidebarNode =
  | {
      kind: "session";
      /** The conversation's segment id (the overview handle). */
      sessionId: string;
      title: string;
      /** Scroll-to anchor: the task's trace key ("tracking means: pointer —
       *  click will scroll to where the partial id is"). Null = open at latest. */
      anchorTraceId: string | null;
    }
  | { kind: "workspace"; workspaceId: string; anchorTraceId: string | null };

export const useConversationSidebarStore = defineStore(
  "conversation-sidebar",
  () => {
    const activeNode = ref<SidebarNode | null>(null);

    const isOpen = computed(() => activeNode.value !== null);

    function openSession(input: {
      sessionId: string;
      title: string;
      anchorTraceId?: string | null;
    }) {
      activeNode.value = {
        kind: "session",
        sessionId: input.sessionId,
        title: input.title,
        anchorTraceId: input.anchorTraceId ?? null,
      };
    }

    function openWorkspace(input: {
      workspaceId: string;
      anchorTraceId?: string | null;
    }) {
      activeNode.value = {
        kind: "workspace",
        workspaceId: input.workspaceId,
        anchorTraceId: input.anchorTraceId ?? null,
      };
    }

    function close() {
      activeNode.value = null;
    }

    return { isOpen, activeNode, openSession, openWorkspace, close };
  },
);
