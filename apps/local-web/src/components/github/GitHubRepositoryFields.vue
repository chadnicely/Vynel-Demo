<script setup lang="ts">
import { PhGlobe, PhLock } from "@phosphor-icons/vue";
import type { RepositoryVisibility } from "../../composables/github/use-github-repository.js";

// The two things a GitHub repository needs from the person: its name and
// whether the world can see it. Shared by the wizard's account step and the
// header's "Connect to GitHub" — one home, one wording.
defineProps<{
  name: string;
  visibility: RepositoryVisibility;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:name": [value: string];
  "update:visibility": [value: RepositoryVisibility];
}>();

const CHOICES: { id: RepositoryVisibility; label: string; hint: string }[] = [
  { id: "private", label: "Private", hint: "Only you and people you invite" },
  { id: "public", label: "Public", hint: "Anyone on GitHub can see it" },
];
</script>

<template>
  <div class="grid gap-2.5">
    <label class="grid gap-1">
      <span class="text-[11.5px] font-semibold text-ink-2"
        >Repository name</span
      >
      <input
        :value="name"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="my-workspace"
        :disabled="disabled"
        class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3 focus:border-gold focus:outline-none disabled:opacity-55"
        @input="emit('update:name', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <div
      class="grid grid-cols-2 gap-2"
      role="radiogroup"
      aria-label="Repository visibility"
    >
      <button
        v-for="choice in CHOICES"
        :key="choice.id"
        type="button"
        role="radio"
        :aria-checked="visibility === choice.id"
        :disabled="disabled"
        class="grid cursor-default gap-0.5 rounded-sm border px-2.5 py-2 text-left transition disabled:opacity-55"
        :class="
          visibility === choice.id
            ? 'border-gold bg-gold-soft'
            : 'border-hair-strong hover:bg-row-hover'
        "
        @click="emit('update:visibility', choice.id)"
      >
        <span class="inline-flex items-center gap-1.5 text-[12.5px] text-ink-1">
          <PhLock v-if="choice.id === 'private'" :size="12" />
          <PhGlobe v-else :size="12" />
          {{ choice.label }}
        </span>
        <span class="text-[11px] text-ink-3">{{ choice.hint }}</span>
      </button>
    </div>
  </div>
</template>
