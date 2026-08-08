import { computed, ref } from "vue";
import { defineStore } from "pinia";

// The app sidebar (live-tracking redesign, Case 1): the pointer's landing — a
// docked right panel showing the REAL conversation of whoever is working. One
// unified flow, no tabs, no derived views. Nodes STACK: a pointer clicked
// INSIDE the sidebar drills deeper and Back walks up (the old monitor-panel
// stacking rule); opening from a thread REPLACES the stack.
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

export const useAppSidebarStore = defineStore("app-sidebar", () => {
  const stack = ref<SidebarNode[]>([]);

  const isOpen = computed(() => stack.value.length > 0);
  const activeNode = computed(() => stack.value[stack.value.length - 1] ?? null);

  function open(node: SidebarNode, options: { push?: boolean } = {}) {
    stack.value = options.push === true && stack.value.length > 0 ? [...stack.value, node] : [node];
  }

  function openSession(
    input: { sessionId: string; title: string; anchorTraceId?: string | null },
    options: { push?: boolean } = {},
  ) {
    open(
      {
        kind: "session",
        sessionId: input.sessionId,
        title: input.title,
        anchorTraceId: input.anchorTraceId ?? null,
      },
      options,
    );
  }

  function openWorkspace(
    input: { workspaceId: string; anchorTraceId?: string | null },
    options: { push?: boolean } = {},
  ) {
    open(
      {
        kind: "workspace",
        workspaceId: input.workspaceId,
        anchorTraceId: input.anchorTraceId ?? null,
      },
      options,
    );
  }

  function back() {
    stack.value = stack.value.slice(0, -1);
  }

  function close() {
    stack.value = [];
  }

  return { stack, isOpen, activeNode, openSession, openWorkspace, back, close };
});
