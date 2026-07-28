<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useStartServerInstall } from "../../composables/server-install/use-start-server-install.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Installing Vynel's engine on the user's own server. The sign-in secret
// enters HERE and nowhere else: it is sealed by the daemon on arrival and no
// response ever carries it back (the AddServerDialog discipline).

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; started: [] }>();

const host = ref("");
const port = ref("22");
const username = ref("");
const authKind = ref<"password" | "private-key">("password");
const password = ref("");
const privateKey = ref("");
const passphrase = ref("");

const start = useStartServerInstall();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    host.value = "";
    port.value = "22";
    username.value = "";
    authKind.value = "password";
    password.value = "";
    privateKey.value = "";
    passphrase.value = "";
    start.reset();
  },
  { immediate: true },
);

const parsedPort = computed(() => Number(port.value));
const isPortValid = computed(
  () => Number.isInteger(parsedPort.value) && parsedPort.value >= 1 && parsedPort.value <= 65535,
);
const hasSecret = computed(() =>
  authKind.value === "password" ? password.value.length > 0 : privateKey.value.trim().length > 0,
);
const canStart = computed(
  () =>
    host.value.trim().length > 0 &&
    username.value.trim().length > 0 &&
    isPortValid.value &&
    hasSecret.value &&
    !start.isPending.value,
);
const errorMessage = computed(() =>
  start.error.value ? formatSdkError(start.error.value) : null,
);

function install() {
  if (!canStart.value) return;
  const credentials =
    authKind.value === "password"
      ? { authKind: "password" as const, password: password.value }
      : {
          authKind: "private-key" as const,
          privateKey: privateKey.value,
          ...(passphrase.value.length > 0 ? { passphrase: passphrase.value } : {}),
        };
  start.mutate(
    {
      host: host.value.trim(),
      port: parsedPort.value,
      username: username.value.trim(),
      credentials,
    },
    {
      onSuccess: () => {
        password.value = "";
        privateKey.value = "";
        passphrase.value = "";
        emit("started");
      },
    },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Install Vynel's engine on your server"
    description="Vynel connects over SSH, installs itself, and keeps running there. Your sign-in details are encrypted on this machine and never shown again."
    size="md"
    @update:open="onOpenChange"
  >
    <div class="grid gap-3">
      <label class="grid gap-1.5">
        <span class="text-xs font-semibold text-ink-2">Server address</span>
        <input
          v-model="host"
          aria-label="Server address"
          placeholder="vynel.example.com or 203.0.113.10"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="install"
        />
      </label>

      <div class="grid grid-cols-[1fr_120px] gap-3">
        <label class="grid gap-1.5">
          <span class="text-xs font-semibold text-ink-2">Sign-in username</span>
          <input
            v-model="username"
            aria-label="Sign-in username"
            placeholder="root"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
            @keydown.enter.prevent="install"
          />
        </label>
        <label class="grid gap-1.5">
          <span class="text-xs font-semibold text-ink-2">Port</span>
          <input
            v-model="port"
            aria-label="Port"
            :class="{ 'border-danger': !isPortValid }"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
            @keydown.enter.prevent="install"
          />
        </label>
      </div>

      <div class="choice-cards grid gap-2" role="radiogroup" aria-label="How Vynel signs in">
        <label
          class="choice flex cursor-default items-center gap-2 rounded-sm border border-hair px-2.5 py-2 text-[12.5px] text-ink-1"
          :class="{ 'is-active border-gold': authKind === 'password' }"
        >
          <input v-model="authKind" type="radio" value="password" aria-label="Sign in with a password" />
          <span>With a password</span>
        </label>
        <label
          class="choice flex cursor-default items-center gap-2 rounded-sm border border-hair px-2.5 py-2 text-[12.5px] text-ink-1"
          :class="{ 'is-active border-gold': authKind === 'private-key' }"
        >
          <input v-model="authKind" type="radio" value="private-key" aria-label="Sign in with a private key" />
          <span>With a private key</span>
        </label>
      </div>

      <label v-if="authKind === 'password'" class="grid gap-1.5">
        <span class="text-xs font-semibold text-ink-2">Password</span>
        <input
          v-model="password"
          type="password"
          aria-label="Password"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="install"
        />
      </label>

      <template v-else>
        <label class="grid gap-1.5">
          <span class="text-xs font-semibold text-ink-2">Private key</span>
          <textarea
            v-model="privateKey"
            aria-label="Private key"
            rows="4"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[11.5px] text-ink-1 placeholder:text-ink-3"
          />
        </label>
        <label class="grid gap-1.5">
          <span class="text-xs font-semibold text-ink-2">Key passphrase (if it has one)</span>
          <input
            v-model="passphrase"
            type="password"
            aria-label="Key passphrase"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
            @keydown.enter.prevent="install"
          />
        </label>
      </template>

      <p class="m-0 text-xs text-ink-3">
        The server needs to be Linux (Debian or Ubuntu work well) with about 1 GB free. Vynel
        checks it before installing anything and tells you if something is missing.
      </p>
      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">{{ errorMessage }}</p>
    </div>

    <template #footer>
      <button
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canStart"
        @click="install"
      >
        {{ start.isPending.value ? "Starting…" : "Install engine" }}
      </button>
    </template>
  </Modal>
</template>
