<script setup lang="ts">
import { ref, watch } from "vue";
import { PhCloud as Cloud } from "@phosphor-icons/vue";
import type { VoiceProviderStatus } from "../../composables/voice/use-voice-providers.js";

// One cloud voice provider row (Settings → Voice): connect with an API key,
// see the connection, disconnect. The key field is masked, cleared the moment
// connect succeeds, and never rendered back — no response carries it. The
// pick controls (speak-with-this, the voice select) ride the default slot so
// this card stays pure connection state.

const props = defineProps<{
  provider: VoiceProviderStatus;
  busy: boolean;
  /** The connect that failed for THIS provider, if any — shown inline. */
  failureMessage: string | null;
}>();

const emit = defineEmits<{
  connect: [apiKey: string];
  disconnect: [];
}>();

const isFormOpen = ref(false);
const apiKeyInput = ref("");

function submitConnect() {
  const apiKey = apiKeyInput.value.trim();
  if (apiKey.length === 0 || props.busy) return;
  emit("connect", apiKey);
}

function closeForm() {
  isFormOpen.value = false;
  apiKeyInput.value = "";
}

// The parent reports success by flipping `provider.connected` — close the
// form and drop the key from this component's memory the moment it lands.
watch(
  () => props.provider.connected,
  (connected) => {
    if (connected) closeForm();
  },
);
</script>

<template>
  <div class="voice-provider-card flex flex-col gap-2 rounded-md border border-hair bg-surface p-3">
    <div class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="flex items-center gap-1.5 text-xs font-semibold text-ink-1">
          <Cloud :size="13" /> {{ provider.label }}
          <span
            v-if="provider.connected"
            class="rounded-full border border-hair px-1.5 text-[10px] font-medium text-ink-2"
          >
            Connected<template v-if="provider.accountLabel"> · {{ provider.accountLabel }}</template>
          </span>
        </span>
        <span class="text-xs text-ink-3">{{ provider.tagline }}</span>
      </div>
      <button
        v-if="!provider.connected && !isFormOpen"
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3 py-1 text-[11px] font-semibold text-ink-2 transition hover:text-ink-1"
        @click="isFormOpen = true"
      >
        Connect…
      </button>
      <button
        v-else-if="provider.connected"
        type="button"
        class="cursor-default rounded-sm border border-hair px-3 py-1 text-[11px] font-medium text-ink-3 transition hover:text-ink-1 disabled:opacity-60"
        :disabled="busy"
        @click="emit('disconnect')"
      >
        Disconnect
      </button>
    </div>

    <form v-if="isFormOpen && !provider.connected" class="flex flex-col gap-2" @submit.prevent="submitConnect">
      <p class="m-0 text-xs text-ink-3">{{ provider.connectHint }}</p>
      <div class="flex items-center gap-2">
        <input
          v-model="apiKeyInput"
          type="password"
          autocomplete="off"
          class="min-w-0 flex-1 rounded-sm border border-hair bg-inset px-2 py-1 text-xs text-ink-1"
          :placeholder="provider.credentialField.placeholder"
          :aria-label="`${provider.label} ${provider.credentialField.label}`"
        />
        <button
          type="submit"
          class="cursor-default rounded-sm border border-hair-strong px-3 py-1 text-[11px] font-semibold text-ink-2 transition hover:text-ink-1 disabled:opacity-60"
          :disabled="busy || apiKeyInput.trim().length === 0"
        >
          {{ busy ? "Checking…" : "Connect" }}
        </button>
        <button
          type="button"
          class="cursor-default rounded-sm px-2 py-1 text-[11px] text-ink-3 transition hover:text-ink-1"
          @click="closeForm"
        >
          Cancel
        </button>
      </div>
      <p v-if="failureMessage" class="m-0 text-xs text-danger" role="alert">{{ failureMessage }}</p>
    </form>

    <slot />
  </div>
</template>
