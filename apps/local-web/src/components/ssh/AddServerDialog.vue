<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal, SegmentedTabs } from "@vynel/ui";
import type { SegmentedTab } from "@vynel/ui";
import { useAddSshServer } from "../../composables/ssh-servers/use-add-ssh-server.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "../sections/section-scope.js";

// Add a server: where it is, how to sign in (password or a key file's
// contents), and where it lives. The secret rides this one request, is sealed
// server-side, and is never echoed back — the fields clear on success.
const props = defineProps<{
  open: boolean;
  /** Where the dialog was opened from — a workspace defaults to itself. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  added: [];
}>();

type AuthKind = "password" | "private-key";

const AUTH_TABS: SegmentedTab[] = [
  { id: "password", label: "Password" },
  { id: "private-key", label: "Private key" },
];

const name = ref("");
const host = ref("");
const port = ref("22");
const username = ref("");
const authKind = ref<AuthKind>("password");
const password = ref("");
const privateKey = ref("");
const passphrase = ref("");

const addServer = useAddSshServer();

// A fresh dialog per open — `immediate` covers a dialog mounted already-open
// (the watcher would otherwise never seed the fields).
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = "";
    host.value = "";
    port.value = "22";
    username.value = "";
    authKind.value = "password";
    password.value = "";
    privateKey.value = "";
    passphrase.value = "";
    addServer.reset();
  },
  { immediate: true },
);

// Empty falls back to the server's default (22); anything typed must be a
// real port so a slip never lands as a row that can't connect.
const portNumber = computed<number | null>(() => {
  const typed = port.value.trim();
  if (typed.length === 0) return null;
  const parsed = Number(typed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
    ? parsed
    : null;
});
const isPortValid = computed(
  () => port.value.trim().length === 0 || portNumber.value !== null,
);

const hasCredential = computed(() =>
  authKind.value === "password"
    ? password.value.length > 0
    : privateKey.value.trim().length > 0,
);

const canAdd = computed(
  () =>
    name.value.trim().length > 0 &&
    host.value.trim().length > 0 &&
    username.value.trim().length > 0 &&
    isPortValid.value &&
    hasCredential.value &&
    !addServer.isPending.value,
);

const errorMessage = computed(() =>
  addServer.error.value ? formatSdkError(addServer.error.value) : null,
);

function add() {
  if (!canAdd.value) return;
  // Secrets go through untouched (a password may genuinely hold spaces).
  const credentials =
    authKind.value === "password"
      ? { authKind: "password" as const, password: password.value }
      : {
          authKind: "private-key" as const,
          privateKey: privateKey.value,
          ...(passphrase.value.length > 0
            ? { passphrase: passphrase.value }
            : {}),
        };
  const shared = {
    name: name.value.trim(),
    host: host.value.trim(),
    username: username.value.trim(),
    ...(portNumber.value !== null ? { port: portNumber.value } : {}),
    credentials,
  };
  addServer.mutate(
    props.defaultScope.kind === "workspace"
      ? {
          scope: "workspace",
          workspaceId: props.defaultScope.workspaceId,
          ...shared,
        }
      : { scope: "global", ...shared },
    {
      onSuccess: () => {
        // The secret's only home was this form — drop it the moment it lands.
        password.value = "";
        privateKey.value = "";
        passphrase.value = "";
        emit("added");
      },
    },
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
    title="Add a server"
    description="Tell Claude where it is and how to sign in — it connects for you and does the work."
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="name"
          type="text"
          maxlength="60"
          autofocus
          placeholder="My web server"
          aria-label="Server name"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="add"
        />
      </label>

      <div class="grid grid-cols-[1fr_92px] gap-2">
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2"
            >Server address</span
          >
          <input
            v-model="host"
            type="text"
            placeholder="example.com"
            aria-label="Server address"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
            @keydown.enter.prevent="add"
          />
        </label>
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">Port</span>
          <input
            v-model="port"
            type="text"
            inputmode="numeric"
            placeholder="22"
            aria-label="Port"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
            :class="{ 'border-danger': !isPortValid }"
            @keydown.enter.prevent="add"
          />
        </label>
      </div>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Username</span>
        <input
          v-model="username"
          type="text"
          placeholder="root"
          aria-label="Username"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="add"
        />
      </label>

      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">
          How do you sign in?
        </span>
        <SegmentedTabs
          :tabs="AUTH_TABS"
          :model-value="authKind"
          @update:model-value="authKind = $event as AuthKind"
        />
      </div>

      <label v-if="authKind === 'password'" class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Password</span>
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          aria-label="Password"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
          @keydown.enter.prevent="add"
        />
      </label>

      <template v-else>
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2"
            >Private key</span
          >
          <textarea
            v-model="privateKey"
            rows="4"
            placeholder="Paste the key file's contents (it starts with -----BEGIN)"
            aria-label="Private key"
            class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[11.5px] text-ink-1 placeholder:font-sans placeholder:text-ink-3"
          ></textarea>
        </label>
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">
            Passphrase
            <span
              class="text-[10px] font-medium uppercase tracking-wide text-ink-3"
              >optional</span
            >
          </span>
          <input
            v-model="passphrase"
            type="password"
            autocomplete="new-password"
            aria-label="Passphrase"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
            @keydown.enter.prevent="add"
          />
        </label>
      </template>

      <p class="m-0 text-[11px] text-ink-3">
        Your password/key is encrypted and never shown again — not even to
        Claude.
      </p>

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
        :disabled="!canAdd"
        @click="add"
      >
        {{ addServer.isPending.value ? "Adding…" : "Add server" }}
      </button>
    </template>
  </Modal>
</template>
