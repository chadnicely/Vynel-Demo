<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import {
  useStartClaudeAuth,
  useSubmitClaudeAuthCode,
} from "../../composables/server-install/use-claude-auth.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Signing the server in to Claude. The server's own Claude program prints a
// link; the user approves in their browser and pastes the code back. Vynel
// carries the link out and the code in — it never sees the credential itself.

const props = defineProps<{ open: boolean; installId: string; host: string }>();
const emit = defineEmits<{ close: []; signedIn: [] }>();

const start = useStartClaudeAuth();
const submit = useSubmitClaudeAuthCode();
const code = ref("");

watch(
  () => props.open,
  (open) => {
    code.value = "";
    start.reset();
    submit.reset();
    if (open) start.mutate({ installId: props.installId });
  },
  { immediate: true },
);

const authorizationUrl = computed(() => start.data.value?.authorizationUrl ?? null);
const isSignedIn = computed(() => submit.data.value?.phase === "signed-in");
const failure = computed(() => {
  if (start.error.value) return formatSdkError(start.error.value);
  if (submit.error.value) return formatSdkError(submit.error.value);
  if (submit.data.value?.phase === "failed") return submit.data.value.errorMessage;
  return null;
});

function finish() {
  if (code.value.trim().length === 0) return;
  submit.mutate(
    { installId: props.installId, code: code.value },
    {
      onSuccess: (state) => {
        code.value = "";
        if (state.phase === "signed-in") emit("signedIn");
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
    title="Sign in to Claude on your server"
    :description="`Your server (${props.host}) needs to sign in to your Claude account so it can think there. This uses your existing subscription.`"
    size="md"
    @update:open="onOpenChange"
  >
    <div class="grid gap-3">
      <p v-if="start.isPending.value" class="starting m-0 text-xs text-ink-2">
        Asking your server for a sign-in link…
      </p>

      <template v-else-if="authorizationUrl && !isSignedIn">
        <div class="grid gap-1.5">
          <span class="text-xs font-semibold text-ink-2">1. Open this link and approve</span>
          <a
            class="auth-link break-all rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12px] text-gold underline"
            :href="authorizationUrl"
            target="_blank"
            rel="noopener noreferrer"
            >{{ authorizationUrl }}</a
          >
        </div>
        <label class="grid gap-1.5">
          <span class="text-xs font-semibold text-ink-2">2. Paste the code it gives you</span>
          <input
            v-model="code"
            aria-label="Authorization code"
            placeholder="Paste the code here"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
            @keydown.enter.prevent="finish"
          />
        </label>
      </template>

      <p v-if="isSignedIn" class="signed-in m-0 text-xs text-ink-1" role="status">
        Your server is signed in. It can think on its own now.
      </p>
      <p v-if="failure" class="m-0 text-xs text-danger" role="alert">{{ failure }}</p>
    </div>

    <template #footer>
      <button
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        {{ isSignedIn ? "Done" : "Cancel" }}
      </button>
      <button
        v-if="!isSignedIn"
        class="finish-button cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!authorizationUrl || code.trim().length === 0 || submit.isPending.value"
        @click="finish"
      >
        {{ submit.isPending.value ? "Finishing…" : "Finish sign-in" }}
      </button>
    </template>
  </Modal>
</template>
