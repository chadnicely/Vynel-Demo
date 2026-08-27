<script setup lang="ts">
// Settings → Voice → Brain (the voice tier, 2026-08-27): which model answers a
// spoken turn, and whether it pauses to think first. Both are USER-level
// preferences the engine resolves per voice turn — no daemon reload, a change
// applies from the next spoken turn. Self-contained like DesktopControlSection:
// this block owns its own preference read/write (no daemon apply cycle to
// share with the parent's model picks).

import { computed } from "vue";
import {
  useUpdateUserPreferences,
  useUserPreferences,
} from "../../composables/users/use-user-preferences.js";
import {
  VOICE_TIER_MODEL,
  VOICE_TIER_FALLBACK_MODEL,
  DEFAULT_VOICE_TIER_THINKING,
  isVoiceTierModel,
  isVoiceTierThinking,
} from "@vynel/contracts/chat/voice-tier";

const preferencesQuery = useUserPreferences();
const updatePreferences = useUpdateUserPreferences();
const preferences = computed(() => preferencesQuery.data.value ?? null);

// Values are guarded to the tier's own vocabulary, so a stray option value can
// never save.
function chooseTierModel(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (isVoiceTierModel(value)) updatePreferences.mutate({ voiceTierModel: value });
}

function chooseTierThinking(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (isVoiceTierThinking(value)) updatePreferences.mutate({ voiceTierThinking: value });
}
</script>

<template>
  <section class="voice-brain-settings flex flex-col gap-2">
    <h3 class="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Brain</h3>
    <p class="m-0 text-xs text-ink-3">
      Which model answers when you speak, and whether it pauses to think first. The fast picks
      are the default; a change applies from the next voice turn.
    </p>
    <div
      class="voice-brain flex flex-wrap items-center gap-4 rounded-xl border border-hair bg-raised px-3.5 py-2.5"
    >
      <label class="voice-brain-model flex items-center gap-2 text-xs text-ink-2">
        Model
        <select
          class="rounded-sm border border-hair bg-inset px-2 py-1 text-xs text-ink-1"
          :value="preferences?.voiceTierModel ?? VOICE_TIER_MODEL"
          :disabled="updatePreferences.isPending.value"
          @change="chooseTierModel"
        >
          <option :value="VOICE_TIER_MODEL">Fast — Haiku 4.5</option>
          <option :value="VOICE_TIER_FALLBACK_MODEL">Smarter — Sonnet 5</option>
        </select>
      </label>
      <label class="voice-brain-thinking flex items-center gap-2 text-xs text-ink-2">
        Thinking
        <select
          class="rounded-sm border border-hair bg-inset px-2 py-1 text-xs text-ink-1"
          :value="preferences?.voiceTierThinking ?? DEFAULT_VOICE_TIER_THINKING"
          :disabled="updatePreferences.isPending.value"
          @change="chooseTierThinking"
        >
          <option value="off">Off — speaks immediately</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High — deepest, slowest</option>
        </select>
      </label>
    </div>
    <p v-if="updatePreferences.isError.value" class="m-0 text-xs text-danger" role="alert">
      Could not save that. Your setting is unchanged.
    </p>
  </section>
</template>
