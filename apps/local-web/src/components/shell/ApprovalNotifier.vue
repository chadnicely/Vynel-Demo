<script setup lang="ts">
import { computed } from "vue";
import { ApprovalCard, DESKTOP_TOOL_PREFIX } from "@vynel/ui";
import { usePendingApprovals } from "../../composables/approvals/use-pending-approvals.js";
import { useDecideApproval } from "../../composables/approvals/use-decide-approval.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { useBrowserStore } from "../../stores/browser-store.js";
import { isTauriShell } from "../../composables/voice/tauri-overlay-window.js";

// Approvals are notifications (Chad's directive): whatever view is open, a
// pending approval slides in here, decidable on the spot. Polls the REAL
// approvals API — this surface is live end-to-end today. In browser mode
// the toasts dock LEFT over the chat — the right side is the native page
// webview, which draws above all HTML and would swallow them.
const MAX_VISIBLE = 3;
const browser = useBrowserStore();

const pendingQuery = usePendingApprovals();
const decideApproval = useDecideApproval();
const workspacesQuery = useWorkspaceList();

// Inside the desktop shell a desktop approval belongs on the attention overlay
// (parked over the app Claude is driving, where the user is actually looking),
// so showing it here too would ask the same question twice in two places. In a
// plain browser there IS no overlay window — these toasts are the only door,
// so they keep rendering.
const hasOverlayWindow = isTauriShell();

const pending = computed(() =>
  (pendingQuery.data.value ?? []).filter(
    (approval) =>
      !hasOverlayWindow || !approval.toolName.startsWith(DESKTOP_TOOL_PREFIX),
  ),
);
const visible = computed(() => pending.value.slice(0, MAX_VISIBLE));
const hiddenCount = computed(() =>
  Math.max(0, pending.value.length - MAX_VISIBLE),
);

function contextLabelFor(workspaceId: string | null): string {
  if (workspaceId === null) return "your assistant's own workspace";
  const workspace = workspacesQuery.data.value?.find(
    (row) => row.id === workspaceId,
  );
  return workspace?.name ?? "a workspace";
}

function decide(providerApprovalId: string, kind: "approved" | "denied") {
  decideApproval.mutate(
    kind === "approved"
      ? { providerApprovalId, kind }
      : {
          providerApprovalId,
          kind,
          reason: "Denied from the approval notification",
        },
  );
}
</script>

<template>
  <div
    class="approval-notifier"
    :class="{ 'dock-start': browser.isOpen }"
    aria-live="polite"
  >
    <TransitionGroup name="toast">
      <ApprovalCard
        v-for="approval in visible"
        :key="approval.id"
        compact
        :tool-name="approval.toolName"
        :tool-input="approval.toolInput"
        :action-kind="approval.actionKind"
        :context-label="contextLabelFor(approval.workspaceId)"
        :busy="decideApproval.isPending.value"
        class="toast"
        @approve="decide(approval.providerApprovalId, 'approved')"
        @deny="decide(approval.providerApprovalId, 'denied')"
      />
    </TransitionGroup>
    <p v-if="hiddenCount > 0" class="more-note">
      +{{ hiddenCount }} more waiting
    </p>
  </div>
</template>

<style scoped>
/* Bottom-right (Chad's call): visible and decidable from any view, without
   covering the titlebar or the top of the content. */
.approval-notifier {
  position: fixed;
  bottom: 16px;
  right: 14px;
  z-index: 50;
  width: 340px;
  display: grid;
  gap: 8px;
  align-content: end;
  pointer-events: none;
}

/* Browser mode: the native page webview owns the right side and draws above
   all HTML — the toasts dock left, over the chat, so they stay decidable. */
.dock-start {
  right: auto;
  left: 14px;
}

.toast {
  pointer-events: auto;
}

.more-note {
  margin: 0;
  text-align: right;
  color: var(--ink-3);
  font: 500 11px/1.5 var(--font-ui);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--t-slow) var(--ease-out),
    transform var(--t-slow) var(--ease-out);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
