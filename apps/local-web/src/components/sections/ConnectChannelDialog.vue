<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChannelKind } from "@vynel/contracts/channels/channel-http";
import { Modal } from "@vynel/ui";
import { useConnectChannel } from "../../composables/channels/use-connect-channel.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import ChannelBrandIcon from "../channels/ChannelBrandIcon.vue";
import { CHANNEL_CATALOG } from "../channels/channel-catalog.js";
import type { SectionScope } from "./section-scope.js";

// Connect a channel — fully catalog-driven: pick an available kind, fill
// ITS credential fields (Telegram = one token; Zoom = the five Marketplace
// values), name it. Credentials flow straight to the connect route and are
// never echoed back.
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  connected: [];
}>();

const CATALOG_ENTRIES = Object.entries(CHANNEL_CATALOG) as [
  ChannelKind,
  (typeof CHANNEL_CATALOG)[ChannelKind],
][];

const selectedKind = ref<ChannelKind>("telegram");
const entry = computed(() => CHANNEL_CATALOG[selectedKind.value]);

const displayName = ref("");
const credentialValues = ref<Record<string, string>>({});
const allowedSenderId = ref("");

const connectChannel = useConnectChannel();

function seedForKind(kind: ChannelKind) {
  displayName.value = CHANNEL_CATALOG[kind].defaultName;
  credentialValues.value = {};
  allowedSenderId.value = "";
}

function selectKind(kind: ChannelKind) {
  if (!CHANNEL_CATALOG[kind].available || kind === selectedKind.value) return;
  selectedKind.value = kind;
  seedForKind(kind);
  connectChannel.reset();
}

// A fresh dialog per open. `immediate` covers a dialog mounted already-open.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selectedKind.value = "telegram";
    seedForKind("telegram");
    connectChannel.reset();
  },
  { immediate: true },
);

const canConnect = computed(
  () =>
    displayName.value.trim().length > 0 &&
    entry.value.credentialFields.every(
      (field) =>
        field.optional === true ||
        (credentialValues.value[field.key] ?? "").trim().length > 0,
    ) &&
    !connectChannel.isPending.value,
);

const errorMessage = computed(() =>
  connectChannel.error.value
    ? formatSdkError(connectChannel.error.value)
    : null,
);

function connect() {
  if (!canConnect.value) return;
  // Optional fields left empty stay OUT of the bag (the adapter treats a
  // present value as an explicit override).
  const botCredentials = Object.fromEntries(
    entry.value.credentialFields
      .map((field) => [field.key, (credentialValues.value[field.key] ?? "").trim()])
      .filter(([, value]) => value !== ""),
  );
  const senderId = allowedSenderId.value.trim();
  const shared = {
    channelKind: selectedKind.value,
    displayName: displayName.value.trim(),
    botCredentials,
    ...(entry.value.allowedSenderField !== null && senderId.length > 0
      ? { initialAllowedSenderId: senderId }
      : {}),
  };
  connectChannel.mutate(
    props.defaultScope.kind === "workspace"
      ? {
          scope: "workspace",
          workspaceId: props.defaultScope.workspaceId,
          ...shared,
        }
      : { scope: "global", ...shared },
    { onSuccess: () => emit("connected") },
  );
}

// Modal owns Esc / backdrop / focus-trap / scroll-lock; it reports close via
// update:open, which we forward to the parent as `close`.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Connect a channel"
    description="Message Claude from your phone — same brain, same memory, approvals included."
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <div class="grid grid-cols-3 gap-2">
        <component
          :is="kindEntry.available ? 'button' : 'div'"
          v-for="[kind, kindEntry] in CATALOG_ENTRIES"
          :key="kind"
          :type="kindEntry.available ? 'button' : undefined"
          class="flex items-center gap-2.5 rounded-md p-2.5 text-left"
          :class="
            !kindEntry.available
              ? 'cursor-default border border-hair bg-panel opacity-55'
              : kind === selectedKind
                ? 'cursor-pointer border border-gold bg-gold-soft'
                : 'cursor-pointer border border-hair bg-panel transition hover:border-hair-strong'
          "
          :aria-disabled="!kindEntry.available || undefined"
          :aria-pressed="kindEntry.available ? kind === selectedKind : undefined"
          @click="selectKind(kind)"
        >
          <span class="grid size-[26px] shrink-0 place-items-center rounded-sm border border-hair bg-raised">
            <ChannelBrandIcon :kind="kind" :size="15" />
          </span>
          <span class="grid min-w-0 gap-px">
            <span class="text-[12.5px] font-semibold text-ink-1">{{ kindEntry.label }}</span>
            <span class="truncate text-[10.5px] text-ink-3">{{ kindEntry.tagline }}</span>
          </span>
        </component>
      </div>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="displayName"
          type="text"
          maxlength="120"
          autofocus
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
          @keydown.enter.prevent="connect"
        />
      </label>

      <label
        v-for="field in entry.credentialFields"
        :key="`${selectedKind}:${field.key}`"
        class="grid gap-1.5"
      >
        <span class="text-[11.5px] font-semibold text-ink-2">{{ field.label }}</span>
        <input
          v-model="credentialValues[field.key]"
          :type="field.secret ? 'password' : 'text'"
          :placeholder="field.placeholder"
          :autocomplete="field.secret ? 'new-password' : undefined"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="connect"
        />
      </label>
      <span class="text-[11px] text-ink-3">{{ entry.connectHint }}</span>

      <label v-if="entry.allowedSenderField" class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">
          {{ entry.allowedSenderField.label }}
          <span class="text-[10px] font-medium uppercase tracking-wide text-ink-3">optional</span>
        </span>
        <input
          v-model="allowedSenderId"
          type="text"
          :placeholder="entry.allowedSenderField.placeholder"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="connect"
        />
        <span class="text-[11px] text-ink-3">{{ entry.allowedSenderField.hint }}</span>
      </label>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canConnect"
        @click="connect"
      >
        {{ connectChannel.isPending.value ? "Connecting…" : "Connect" }}
      </button>
    </template>
  </Modal>
</template>
