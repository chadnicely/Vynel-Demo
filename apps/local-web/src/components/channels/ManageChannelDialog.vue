<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Plus, X } from "lucide-vue-next";
import { Modal } from "@vynel/ui";
import { useChannels } from "../../composables/channels/use-channels.js";
import { useRenameChannel } from "../../composables/channels/use-rename-channel.js";
import { useSetChannelEnabled } from "../../composables/channels/use-set-channel-enabled.js";
import { useAllowedSenders } from "../../composables/channels/use-allowed-senders.js";
import { useAddAllowedSender } from "../../composables/channels/use-add-allowed-sender.js";
import { useRemoveAllowedSender } from "../../composables/channels/use-remove-allowed-sender.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import ChannelBrandIcon from "./ChannelBrandIcon.vue";
import ChannelGroupsBlock from "./ChannelGroupsBlock.vue";
import {
  CHANNEL_CATALOG,
  channelConnectionNote,
  isChannelHealthy,
} from "./channel-catalog.js";

// Manage one connected channel: rename it, pause/resume polling, and curate
// who's allowed to message the bot. The channel row resolves LIVE from the
// list query by id (the PlanViewDialog lesson — a snapshot prop freezes the
// status tile after one toggle); only the name INPUT snapshots on open, like
// every edit dialog.
const props = defineProps<{
  open: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const channelsQuery = useChannels(() => props.open);
const channel = computed(
  () =>
    (channelsQuery.data.value ?? []).find(
      (row) => row.id === props.channelId,
    ) ?? null,
);

const displayName = ref("");
const hasSeededName = ref(false);

const rename = useRenameChannel();
const nameDirty = computed(
  () =>
    channel.value !== null &&
    displayName.value.trim().length > 0 &&
    displayName.value.trim() !== channel.value.displayName,
);

function saveName() {
  if (!nameDirty.value || channel.value === null || rename.isPending.value)
    return;
  rename.mutate({
    channelId: channel.value.id,
    displayName: displayName.value.trim(),
  });
}

const setEnabled = useSetChannelEnabled();

function toggleEnabled() {
  if (channel.value === null || setEnabled.isPending.value) return;
  setEnabled.mutate({
    channelId: channel.value.id,
    isEnabled: !channel.value.isEnabled,
  });
}

// ── Allowed senders ─────────────────────────────────────────────────
const sendersQuery = useAllowedSenders(() =>
  props.open ? props.channelId : null,
);
const senders = computed(() => sendersQuery.data.value ?? []);

const addSender = useAddAllowedSender();
const newSenderId = ref("");
const newSenderHandle = ref("");
const newSenderName = ref("");

const canAddSender = computed(
  () =>
    channel.value !== null &&
    newSenderId.value.trim().length > 0 &&
    !addSender.isPending.value,
);

function submitSender() {
  if (!canAddSender.value || channel.value === null) return;
  const handle = newSenderHandle.value.trim();
  const name = newSenderName.value.trim();
  addSender.mutate(
    {
      channelId: channel.value.id,
      externalSenderId: newSenderId.value.trim(),
      ...(handle.length > 0 ? { externalSenderHandle: handle } : {}),
      ...(name.length > 0 ? { externalSenderDisplayName: name } : {}),
    },
    {
      onSuccess: () => {
        newSenderId.value = "";
        newSenderHandle.value = "";
        newSenderName.value = "";
      },
    },
  );
}

// Removing revokes access instantly — the X arms first ("Sure?"), only a
// second explicit click fires, and blur disarms (the section-row idiom).
const removeSender = useRemoveAllowedSender();
const armedRemoveId = ref<string | null>(null);

// A fresh dialog per open. The name INPUT seeds once per open, when the row
// is first in hand — the row may still be loading at the moment the dialog
// opens, so seeding keys off "open + row resolved", not off open alone.
// (Declared after every ref/mutation it resets — it fires immediately.)
watch(
  [() => props.open, channel],
  ([open, row], previous) => {
    if (!open) {
      hasSeededName.value = false;
      return;
    }
    const wasOpen = previous?.[0] ?? false;
    if (!wasOpen) {
      displayName.value = "";
      newSenderId.value = "";
      newSenderHandle.value = "";
      newSenderName.value = "";
      armedRemoveId.value = null;
      rename.reset();
      addSender.reset();
    }
    if (!hasSeededName.value && row !== null) {
      displayName.value = row.displayName;
      hasSeededName.value = true;
    }
  },
  { immediate: true },
);

function senderLabel(sender: {
  externalSenderDisplayName: string | null;
  externalSenderHandle: string | null;
  externalSenderId: string;
}): string {
  return (
    sender.externalSenderDisplayName ??
    sender.externalSenderHandle ??
    sender.externalSenderId
  );
}

function requestRemoveSender(senderLinkId: string) {
  if (channel.value === null) return;
  if (armedRemoveId.value !== senderLinkId) {
    armedRemoveId.value = senderLinkId;
    return;
  }
  armedRemoveId.value = null;
  removeSender.mutate({ channelId: channel.value.id, senderLinkId });
}

function disarmRemoveSender(senderLinkId: string) {
  if (armedRemoveId.value === senderLinkId) armedRemoveId.value = null;
}

const errorMessage = computed(() => {
  const failed =
    rename.error.value ??
    setEnabled.error.value ??
    addSender.error.value ??
    removeSender.error.value;
  return failed ? formatSdkError(failed) : null;
});

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="channel ? `Manage ${channel.displayName}` : 'Manage channel'"
    description="Rename it, pause it, and choose who can talk to Claude here."
    @update:open="onOpenChange"
  >
    <div v-if="channel" class="flex flex-col gap-4 pt-1">
      <div class="flex items-center gap-2.5">
        <span
          class="grid size-9 shrink-0 place-items-center rounded-md border border-hair bg-raised"
        >
          <ChannelBrandIcon :kind="channel.channelKind" :size="20" />
        </span>
        <span class="grid min-w-0 gap-px">
          <span class="text-[12.5px] font-semibold text-ink-1">
            {{ CHANNEL_CATALOG[channel.channelKind].label }}
          </span>
          <span
            class="text-[11px]"
            :class="
              channel.isEnabled && isChannelHealthy(channel)
                ? 'text-ok'
                : 'text-ink-3'
            "
          >
            {{ channelConnectionNote(channel) }}
          </span>
        </span>
        <button
          type="button"
          class="pill ml-auto shrink-0 cursor-default rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition"
          :class="
            channel.isEnabled
              ? 'bg-ok/15 text-ok hover:bg-ok/25'
              : 'bg-gold-soft text-gold hover:bg-gold-soft/80'
          "
          :aria-label="
            channel.isEnabled
              ? `Pause ${channel.displayName}`
              : `Resume ${channel.displayName}`
          "
          @click="toggleEnabled"
        >
          {{ channel.isEnabled ? "Active" : "Paused" }}
        </button>
      </div>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <div class="flex gap-2">
          <input
            v-model="displayName"
            type="text"
            maxlength="120"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
            @keydown.enter.prevent="saveName"
          />
          <button
            type="button"
            class="shrink-0 cursor-default rounded-sm border border-hair-strong px-3 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-45"
            :disabled="!nameDirty || rename.isPending.value"
            @click="saveName"
          >
            {{ rename.isPending.value ? "Saving…" : "Save" }}
          </button>
        </div>
      </label>

      <ChannelGroupsBlock :channel-id="channel.id" />

      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">
          Allowed senders
        </span>
        <p class="m-0 text-[11px] text-ink-3">
          Only these people can talk to Claude on this channel. Messages from
          anyone else are ignored.
        </p>

        <ul
          v-if="senders.length > 0"
          class="m-0 flex list-none flex-col gap-1 p-0"
        >
          <li
            v-for="sender in senders"
            :key="sender.id"
            class="sender-row group flex items-center gap-2 rounded-md border border-hair bg-panel px-2.5 py-1.5"
          >
            <span class="min-w-0 flex-1 truncate text-[12px] text-ink-1">
              {{ senderLabel(sender) }}
              <span
                v-if="senderLabel(sender) !== sender.externalSenderId"
                class="text-ink-3"
              >
                · {{ sender.externalSenderId }}</span
              >
            </span>
            <button
              type="button"
              :class="
                armedRemoveId === sender.id
                  ? 'shrink-0 cursor-default rounded-full border border-danger/40 px-2 py-0.5 text-[11px] font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
                  : 'shrink-0 cursor-default rounded-md p-0.5 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100'
              "
              :aria-label="
                armedRemoveId === sender.id
                  ? `Confirm remove ${senderLabel(sender)}`
                  : `Remove ${senderLabel(sender)}`
              "
              @click="requestRemoveSender(sender.id)"
              @blur="disarmRemoveSender(sender.id)"
            >
              <template v-if="armedRemoveId === sender.id">Sure?</template>
              <X v-else :size="13" />
            </button>
          </li>
        </ul>
        <p
          v-else-if="!sendersQuery.isPending.value"
          class="m-0 rounded-md border border-dashed border-hair px-2.5 py-2 text-[11.5px] text-ink-3"
        >
          No allowed senders yet — nobody can message this bot.
        </p>

        <div class="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
          <input
            v-model="newSenderId"
            type="text"
            placeholder="User ID, e.g. 123456789"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2 py-1.5 text-[12px] text-ink-1 placeholder:text-ink-3"
            @keydown.enter.prevent="submitSender"
          />
          <input
            v-model="newSenderHandle"
            type="text"
            placeholder="@handle (optional)"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2 py-1.5 text-[12px] text-ink-1 placeholder:text-ink-3"
            @keydown.enter.prevent="submitSender"
          />
          <input
            v-model="newSenderName"
            type="text"
            placeholder="Name (optional)"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2 py-1.5 text-[12px] text-ink-1 placeholder:text-ink-3"
            @keydown.enter.prevent="submitSender"
          />
          <button
            type="button"
            class="inline-flex shrink-0 cursor-default items-center gap-1 rounded-sm border border-hair-strong px-2.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-45"
            :disabled="!canAddSender"
            aria-label="Add allowed sender"
            @click="submitSender"
          >
            <Plus :size="13" />
            Add
          </button>
        </div>
      </div>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <p
      v-else-if="!channelsQuery.isPending.value"
      class="m-0 pt-1 text-xs text-ink-3"
    >
      This channel is gone — it may have been disconnected.
    </p>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Done
      </button>
    </template>
  </Modal>
</template>
