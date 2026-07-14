<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { MessageSquare, Send } from "lucide-vue-next";
import { Modal } from "@vynel/ui";
import { useConnectChannel } from "../../composables/channels/use-connect-channel.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// Connect a channel: pick the kind (Telegram today; Discord is on the
// roadmap), name it, paste the bot token, choose where it lives (everywhere,
// or one workspace). The token flows straight to the connect route and is
// never echoed back.
const props = defineProps<{
  open: boolean;
  /** Where the dialog was opened from — pre-selects the scope. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  connected: [];
}>();

const displayName = ref("My Telegram");
const botToken = ref("");
const allowedSenderId = ref("");
// "global" or a workspaceId — the select's simple value shape.
const scopeChoice = ref<string>("global");

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived),
);

const connectChannel = useConnectChannel();

// A fresh dialog per open — and the scope follows where it was opened from.
// `immediate` covers a dialog mounted already-open (the watcher would
// otherwise never seed the scope).
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    displayName.value = "My Telegram";
    botToken.value = "";
    allowedSenderId.value = "";
    scopeChoice.value =
      props.defaultScope.kind === "workspace"
        ? props.defaultScope.workspaceId
        : "global";
    connectChannel.reset();
  },
  { immediate: true },
);

const canConnect = computed(
  () =>
    displayName.value.trim().length > 0 &&
    botToken.value.trim().length > 0 &&
    !connectChannel.isPending.value,
);

const errorMessage = computed(() =>
  connectChannel.error.value
    ? formatSdkError(connectChannel.error.value)
    : null,
);

function connect() {
  if (!canConnect.value) return;
  const senderId = allowedSenderId.value.trim();
  const shared = {
    channelKind: "telegram" as const,
    displayName: displayName.value.trim(),
    botCredentials: { botToken: botToken.value.trim() },
    ...(senderId.length > 0 ? { initialAllowedSenderId: senderId } : {}),
  };
  connectChannel.mutate(
    scopeChoice.value === "global"
      ? { scope: "global", ...shared }
      : { scope: "workspace", workspaceId: scopeChoice.value, ...shared },
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
      <div class="grid grid-cols-2 gap-2">
        <div class="flex items-center gap-2.5 rounded-md border border-gold bg-gold-soft p-2.5">
          <span class="grid size-[26px] shrink-0 place-items-center rounded-sm border border-hair bg-raised text-ink-2">
            <Send :size="15" />
          </span>
          <span class="grid min-w-0 gap-px">
            <span class="text-[12.5px] font-semibold text-ink-1">Telegram</span>
            <span class="text-[10.5px] text-ink-3">Two minutes with @BotFather</span>
          </span>
        </div>
        <div class="flex items-center gap-2.5 rounded-md border border-hair bg-panel p-2.5 opacity-55" aria-disabled="true">
          <span class="grid size-[26px] shrink-0 place-items-center rounded-sm border border-hair bg-raised text-ink-2">
            <MessageSquare :size="15" />
          </span>
          <span class="grid min-w-0 gap-px">
            <span class="text-[12.5px] font-semibold text-ink-1">Discord</span>
            <span class="text-[10.5px] text-ink-3">Coming soon</span>
          </span>
        </div>
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

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Bot token</span>
        <input
          v-model="botToken"
          type="password"
          placeholder="123456:ABC-…"
          autocomplete="new-password"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="connect"
        />
        <span class="text-[11px] text-ink-3">
          In Telegram, message @BotFather → /newbot → paste the token it gives
          you. It stays on this computer.
        </span>
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">
          Your Telegram user ID
          <span class="text-[10px] font-medium uppercase tracking-wide text-ink-3">optional</span>
        </span>
        <input
          v-model="allowedSenderId"
          type="text"
          placeholder="e.g. 123456789"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="connect"
        />
        <span class="text-[11px] text-ink-3">
          Only allowed senders can talk to Claude. Add yourself now (ask
          @userinfobot for your ID) or approve senders later.
        </span>
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Where it lives</span>
        <select
          v-model="scopeChoice"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
        >
          <option value="global">Global — Claude everywhere</option>
          <option
            v-for="workspace in workspaces"
            :key="workspace.id"
            :value="workspace.id"
          >
            {{ workspace.name }} workspace
          </option>
        </select>
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
