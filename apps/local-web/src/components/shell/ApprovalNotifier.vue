<script setup lang="ts">
import { computed } from "vue";
import { ApprovalCard } from "@vynel/ui";
import { usePendingApprovals } from "../../composables/approvals/use-pending-approvals.js";
import { useDecideApproval } from "../../composables/approvals/use-decide-approval.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";

// Approvals are notifications (Chad's directive): whatever view is open, a
// pending approval slides in here, decidable on the spot. Polls the REAL
// approvals API — this surface is live end-to-end today.
const MAX_VISIBLE = 3;

const pendingQuery = usePendingApprovals();
const decideApproval = useDecideApproval();
const workspacesQuery = useWorkspaceList();

const pending = computed(() => pendingQuery.data.value ?? []);
const visible = computed(() => pending.value.slice(0, MAX_VISIBLE));
const hiddenCount = computed(() =>
  Math.max(0, pending.value.length - MAX_VISIBLE),
);

function contextLabelFor(workspaceId: string | null): string {
  if (workspaceId === null) return "your assistant's own workspace";
  const workspace = workspacesQuery.data.value?.workspaces.find(
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
          reason: "Denied from the Vynel approval notification",
        },
  );
}
</script>

<template>
  <div class="approval-notifier" aria-live="polite">
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
.approval-notifier {
  position: fixed;
  top: 52px;
  right: 14px;
  z-index: 50;
  width: 340px;
  display: grid;
  gap: 8px;
  pointer-events: none;
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
  transform: translateX(16px);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
