<script setup lang="ts">
import { PresenceDot } from "@vynel/ui";

// The always-there truth line at the foot of the shell: presence + context on
// the left, pending-approval affordance on the right. Data-blind.
const props = defineProps<{
  presenceState: "idle" | "live" | "attention";
  contextLabel: string;
  pendingApprovals: number;
}>();

const emit = defineEmits<{
  "open-approvals": [];
}>();
</script>

<template>
  <footer
    class="flex h-[22px] shrink-0 items-center gap-2 border-t border-hair bg-panel px-3 text-2xs text-ink-3 select-none"
  >
    <PresenceDot :state="props.presenceState" />
    <span class="truncate">{{ props.contextLabel }}</span>

    <button
      v-if="props.pendingApprovals > 0"
      type="button"
      class="ml-auto flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-gold transition hover:bg-gold-soft"
      @click="emit('open-approvals')"
    >
      <span class="size-1.5 rounded-full bg-gold" />
      {{ props.pendingApprovals }}
      {{ props.pendingApprovals === 1 ? "approval" : "approvals" }} waiting
    </button>
  </footer>
</template>
