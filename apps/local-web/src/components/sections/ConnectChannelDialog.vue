<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { MessageSquare, Send } from "lucide-vue-next";
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

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    // Claim the key so outer overlays don't also close on the same press.
    event.preventDefault();
    emit("close");
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="dialog-backdrop"
      @pointerdown.self="emit('close')"
      @keydown="onKeydown"
    >
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Connect a channel"
      >
        <header class="dialog-header">
          <h2 class="dialog-title">Connect a channel</h2>
          <p class="dialog-subtitle">
            Message Claude from your phone — same brain, same memory, approvals
            included.
          </p>
        </header>

        <div class="kind-cards">
          <div class="kind-card is-selected">
            <span class="kind-icon"><Send :size="15" /></span>
            <span class="kind-text">
              <span class="kind-name">Telegram</span>
              <span class="kind-note">Two minutes with @BotFather</span>
            </span>
          </div>
          <div class="kind-card is-disabled" aria-disabled="true">
            <span class="kind-icon"><MessageSquare :size="15" /></span>
            <span class="kind-text">
              <span class="kind-name">Discord</span>
              <span class="kind-note">Coming soon</span>
            </span>
          </div>
        </div>

        <label class="field">
          <span class="field-label">Name</span>
          <input
            v-model="displayName"
            type="text"
            maxlength="120"
            autofocus
            @keydown.enter.prevent="connect"
          />
        </label>

        <label class="field">
          <span class="field-label">Bot token</span>
          <input
            v-model="botToken"
            type="password"
            placeholder="123456:ABC-…"
            autocomplete="new-password"
            @keydown.enter.prevent="connect"
          />
          <span class="field-hint">
            In Telegram, message @BotFather → /newbot → paste the token it
            gives you. It stays on this computer.
          </span>
        </label>

        <label class="field">
          <span class="field-label">
            Your Telegram user ID <span class="optional-tag">optional</span>
          </span>
          <input
            v-model="allowedSenderId"
            type="text"
            placeholder="e.g. 123456789"
            @keydown.enter.prevent="connect"
          />
          <span class="field-hint">
            Only allowed senders can talk to Claude. Add yourself now (ask
            @userinfobot for your ID) or approve senders later.
          </span>
        </label>

        <label class="field">
          <span class="field-label">Where it lives</span>
          <select v-model="scopeChoice" class="scope-select">
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

        <p v-if="errorMessage" class="dialog-error" role="alert">
          {{ errorMessage }}
        </p>

        <footer class="dialog-actions">
          <button type="button" class="ghost" @click="emit('close')">
            Cancel
          </button>
          <button
            type="button"
            class="primary"
            :disabled="!canConnect"
            @click="connect"
          >
            {{ connectChannel.isPending.value ? "Connecting…" : "Connect" }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: var(--bg-overlay);
}

.dialog {
  width: min(460px, calc(100vw - 48px));
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-l);
  background: var(--bg-raised);
  box-shadow: var(--shadow-overlay);
}

.dialog-header {
  display: grid;
  gap: 3px;
}

.dialog-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 15px/1.4 var(--font-ui);
}

.dialog-subtitle {
  margin: 0;
  color: var(--ink-2);
  font: 400 12px/1.5 var(--font-ui);
}

.kind-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.kind-card {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-panel);
}

.kind-card.is-selected {
  border-color: var(--gold);
  background: var(--gold-soft);
}

.kind-card.is-disabled {
  opacity: 0.55;
}

.kind-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  color: var(--ink-2);
  flex: none;
}

.kind-text {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.kind-name {
  color: var(--ink-1);
  font: 600 12.5px/1.4 var(--font-ui);
}

.kind-note {
  color: var(--ink-3);
  font: 400 10.5px/1.4 var(--font-ui);
}

.field {
  display: grid;
  gap: 5px;
}

.field-label {
  color: var(--ink-2);
  font: 600 11.5px/1.5 var(--font-ui);
}

.optional-tag {
  color: var(--ink-3);
  font: 500 10px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field input,
.scope-select {
  appearance: none;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12.5px/1.5 var(--font-ui);
}

.field input:focus-visible,
.scope-select:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
}

.field-hint {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}

.dialog-error {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ghost,
.primary {
  appearance: none;
  border: 1px solid var(--hair-strong);
  margin: 0;
  padding: 6px 14px;
  border-radius: var(--radius-s);
  font: 600 12px/1.5 var(--font-ui);
  cursor: default;
}

.ghost {
  background: transparent;
  color: var(--ink-2);
}

.ghost:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.primary {
  border-color: transparent;
  background: var(--gold);
  color: #14171c;
}

.primary:hover:not(:disabled) {
  background: var(--gold-bright);
}

.primary:disabled {
  opacity: 0.55;
}

.ghost:focus-visible,
.primary:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
