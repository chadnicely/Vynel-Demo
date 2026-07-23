<script setup lang="ts">
import { computed, ref } from "vue";
import { Users } from "lucide-vue-next";
import type { ChannelChatGroupResponse } from "@vynel/contracts/channels/channel-http";
import { useChannelGroups } from "../../composables/channels/use-channel-groups.js";
import { useSetGroupStatus } from "../../composables/channels/use-set-group-status.js";
import { useSetGroupPolicy } from "../../composables/channels/use-set-group-policy.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The Groups section of the Manage dialog: rooms the bot has been seen in.
// Pending rooms ask for a decision (Approve / Ignore); approved rooms carry
// the member-policy select and can be re-ignored; ignored rooms can be
// re-approved. Discovery is the ritual — the hint teaches it.
const props = defineProps<{
  channelId: string;
}>();

const groupsQuery = useChannelGroups(() => props.channelId);
const groups = computed(() => groupsQuery.data.value ?? []);

const setStatus = useSetGroupStatus();
const setPolicy = useSetGroupPolicy();

function groupLabel(group: ChannelChatGroupResponse): string {
  return group.title ?? group.externalChatContextId;
}

function decide(group: ChannelChatGroupResponse, status: "approved" | "ignored") {
  if (setStatus.isPending.value) return;
  setStatus.mutate({ channelId: props.channelId, groupId: group.id, status });
}

// On a failed policy save the bound value is unchanged, so Vue would skip
// the DOM patch and the select would keep showing the value the server
// rejected — bumping the render key forces it back in sync.
const policyResetCount = ref(0);

function onPolicyChange(group: ChannelChatGroupResponse, event: Event) {
  if (setPolicy.isPending.value) return;
  const memberPolicy = (event.target as HTMLSelectElement)
    .value as ChannelChatGroupResponse["memberPolicy"];
  setPolicy.mutate(
    { channelId: props.channelId, groupId: group.id, memberPolicy },
    { onError: () => (policyResetCount.value += 1) },
  );
}

const errorMessage = computed(() => {
  const failed = setStatus.error.value ?? setPolicy.error.value;
  return failed ? formatSdkError(failed) : null;
});

const STATUS_CHIPS: Record<
  ChannelChatGroupResponse["status"],
  { label: string; tone: string }
> = {
  pending: { label: "Wants in", tone: "bg-gold-soft text-gold" },
  approved: { label: "Approved", tone: "bg-ok/15 text-ok" },
  ignored: { label: "Ignored", tone: "bg-hair text-ink-3" },
};
</script>

<template>
  <div class="grid gap-1.5">
    <span
      class="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-2"
    >
      <Users :size="13" />
      Groups
    </span>

    <ul v-if="groups.length > 0" class="m-0 flex list-none flex-col gap-1 p-0">
      <li
        v-for="group in groups"
        :key="group.id"
        class="group-row flex items-center gap-2 rounded-md border border-hair bg-panel px-2.5 py-1.5"
      >
        <span class="min-w-0 flex-1 truncate text-[12px] text-ink-1">
          {{ groupLabel(group) }}
        </span>
        <span
          class="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
          :class="STATUS_CHIPS[group.status].tone"
        >
          {{ STATUS_CHIPS[group.status].label }}
        </span>

        <select
          v-if="group.status === 'approved'"
          :key="`${group.memberPolicy}:${policyResetCount}`"
          class="shrink-0 rounded-sm border border-hair-strong bg-panel px-1.5 py-0.5 text-[11px] text-ink-1"
          :value="group.memberPolicy"
          :aria-label="`Who can talk in ${groupLabel(group)}`"
          @change="onPolicyChange(group, $event)"
        >
          <option value="everyone">Everyone in the group</option>
          <option value="allowlist">Allowed senders only</option>
        </select>

        <button
          v-if="group.status !== 'approved'"
          type="button"
          class="shrink-0 cursor-default rounded-full border border-hair-strong px-2.5 py-0.5 text-[11px] font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          :aria-label="`Approve ${groupLabel(group)}`"
          @click="decide(group, 'approved')"
        >
          Approve
        </button>
        <button
          v-if="group.status !== 'ignored'"
          type="button"
          class="shrink-0 cursor-default rounded-full border border-hair px-2.5 py-0.5 text-[11px] font-semibold text-ink-3 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          :aria-label="`Ignore ${groupLabel(group)}`"
          @click="decide(group, 'ignored')"
        >
          Ignore
        </button>
      </li>
    </ul>

    <p
      v-else-if="!groupsQuery.isPending.value"
      class="m-0 rounded-md border border-dashed border-hair px-2.5 py-2 text-[11.5px] text-ink-3"
    >
      No groups yet — add the bot to a group and @mention it once, and the
      group appears here for approval.
    </p>

    <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
      {{ errorMessage }}
    </p>
  </div>
</template>
