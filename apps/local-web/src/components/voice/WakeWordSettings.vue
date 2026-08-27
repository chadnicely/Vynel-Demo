<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  WAKE_NAME_MAX_LENGTH,
  WAKE_NAME_MIN_LENGTH,
  isValidWakeName,
} from "@vynel/contracts/voice/voice-providers";
import type { UserPreferencesPatch } from "../../composables/users/use-user-preferences.js";

// Settings → Voice, "Hearing · wake word": the user's OWN wake name. "Hey
// <name>" opens the conversation BESIDE the built-in names — "hey Vynel" and
// "hey Claude" keep working, so a name the recognizer can't hear never locks
// anyone out — and it is matched loosely (close mishearings still wake).
// Saving rides the section's save→reload cycle, so the running daemon answers
// to it from the very next utterance.

const props = defineProps<{
  wakeName: string | null;
  saving: boolean;
}>();

const emit = defineEmits<{ save: [patch: UserPreferencesPatch] }>();

const draft = ref(props.wakeName ?? "");
watch(
  () => props.wakeName,
  (next) => {
    draft.value = next ?? "";
  },
);

const trimmed = computed(() => draft.value.trim());
const isDraftValid = computed(() => trimmed.value === "" || isValidWakeName(trimmed.value));
const isDirty = computed(() => trimmed.value !== (props.wakeName ?? ""));
const canSave = computed(() => isDirty.value && isDraftValid.value && !props.saving);

function save(): void {
  if (!canSave.value) return;
  // "" is the CLEAR — back to the built-in names only.
  emit("save", { voiceWakeName: trimmed.value });
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="m-0 text-xs text-ink-3">
      Add your own wake name — “hey {{ trimmed || "…" }}” will open the conversation too. “Hey
      Vynel” always keeps working. One word, {{ WAKE_NAME_MIN_LENGTH }}–{{ WAKE_NAME_MAX_LENGTH }}
      characters.
    </p>
    <div class="flex items-center gap-2">
      <input
        v-model="draft"
        type="text"
        class="w-44 rounded border border-ink-4 bg-transparent px-2 py-1 text-xs text-ink-1"
        :maxlength="WAKE_NAME_MAX_LENGTH"
        placeholder="e.g. Friday"
        data-testid="wake-name-input"
        :disabled="props.saving"
        @keydown.enter.prevent="save"
      />
      <button
        type="button"
        class="rounded border border-ink-4 px-3 py-1 text-xs text-ink-2 disabled:opacity-50"
        data-testid="wake-name-save"
        :disabled="!canSave"
        @click="save"
      >
        {{ trimmed === "" && props.wakeName !== null ? "Clear" : "Save" }}
      </button>
    </div>
    <p v-if="!isDraftValid" class="m-0 text-xs text-red-400" data-testid="wake-name-invalid">
      One word of {{ WAKE_NAME_MIN_LENGTH }}–{{ WAKE_NAME_MAX_LENGTH }} characters, starting
      with a letter — no spaces or symbols.
    </p>
  </div>
</template>
