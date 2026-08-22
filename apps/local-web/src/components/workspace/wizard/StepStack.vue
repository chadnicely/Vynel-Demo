<script setup lang="ts">
import { computed, ref } from "vue";
import { PhCaretRight, PhCheck, PhSliders, PhStack } from "@phosphor-icons/vue";
import { ADVANCED_ROWS, deriveStackRows } from "./derive-stack.js";
import { useWizardAnswers } from "./wizard-answers.js";
import WizardChip from "./WizardChip.vue";
import {
  CALLOUT,
  CARD,
  FIELD_LABEL,
  HINT,
  SMALL_BUTTON,
  TEXTAREA,
} from "./wizard-classes.js";

// Screen 9 — the stack, already chosen from the answers, each row carrying
// its plain reason. "Change these" opens option chips per row; Advanced
// settings holds the rest (language, package manager, data access, styling,
// tests) plus the free-notes box. Everything lands in the README + brief —
// the advanced picks fold into the brief's "Also follow" line.
const answers = useWizardAnswers();

const isChanging = ref(false);
const isAdvancedOpen = ref(false);

const rows = computed(() => deriveStackRows(answers));

const because = computed(() => {
  const where =
    answers.where === "A phone app"
      ? "a phone app"
      : answers.where === "Both"
        ? "a website and a phone app"
        : "a website";
  const who =
    {
      "Just me": "you",
      "My team": "your team",
      "My customers": "your customers",
      "Anyone on the internet": "the public",
    }[answers.who ?? ""] ?? "your people";
  return `Because it is ${where} for ${who}, we picked these.`;
});

function pick(key: string, option: string) {
  answers.stackPicks[key] = option;
}

function advancedChoice(key: string, fallback: string): string {
  return answers.stackPicks[key] ?? fallback;
}
</script>

<template>
  <div :class="CALLOUT" class="flex items-center gap-2.5">
    <PhStack :size="15" class="shrink-0 text-gold" />
    <span class="flex-1 text-[12.5px] text-ink-1">{{ because }}</span>
    <button
      type="button"
      :class="SMALL_BUTTON"
      :aria-pressed="isChanging"
      @click="isChanging = !isChanging"
    >
      <template v-if="isChanging"
        ><PhCheck :size="13" /> Done changing</template
      >
      <template v-else><PhSliders :size="13" /> Change these</template>
    </button>
  </div>

  <div class="grid gap-1.5">
    <div
      v-for="row in rows"
      :key="row.key"
      :class="CARD"
      class="grid grid-cols-[112px_1fr] gap-3"
    >
      <div class="grid content-start gap-0.5">
        <span :class="FIELD_LABEL">{{ row.role }}</span>
        <span :class="HINT">{{ row.what }}</span>
      </div>
      <div class="grid gap-1">
        <span class="text-[13px] text-ink-1">{{ row.value }}</span>
        <span :class="HINT">{{ row.note }}</span>
        <div
          v-if="isChanging"
          class="mt-1 flex flex-wrap gap-1.5"
          role="group"
          :aria-label="row.role"
        >
          <WizardChip
            v-for="option in row.options"
            :key="option"
            small
            :on="option === row.value"
            @click="pick(row.key, option)"
          >
            {{ option }}
          </WizardChip>
        </div>
      </div>
    </div>
  </div>

  <p class="m-0 text-[11.5px] text-ink-3">
    If none of this means anything to you, leave it — these are the choices we
    would make for an app like yours.
  </p>

  <button
    type="button"
    class="inline-flex cursor-default items-center gap-1.5 text-[12px] text-ink-2 hover:text-ink-1"
    :aria-expanded="isAdvancedOpen"
    @click="isAdvancedOpen = !isAdvancedOpen"
  >
    <PhCaretRight
      :size="13"
      class="transition"
      :class="{ 'rotate-90': isAdvancedOpen }"
    />
    {{
      isAdvancedOpen
        ? "Hide advanced settings"
        : "Advanced settings — for people who know what they want"
    }}
  </button>

  <div v-if="isAdvancedOpen" class="grid gap-3">
    <div
      v-for="row in ADVANCED_ROWS"
      :key="row.key"
      class="grid grid-cols-[112px_1fr] items-center gap-3"
    >
      <span :class="FIELD_LABEL">{{ row.role }}</span>
      <div class="flex flex-wrap gap-1.5" role="group" :aria-label="row.role">
        <WizardChip
          v-for="option in row.options"
          :key="option"
          small
          :on="option === advancedChoice(row.key, row.fallback)"
          @click="pick(row.key, option)"
        >
          {{ option }}
        </WizardChip>
      </div>
    </div>
    <label class="grid gap-1.5">
      <span :class="FIELD_LABEL">Anything else we should follow?</span>
      <textarea
        v-model="answers.advNotes"
        :class="TEXTAREA"
        placeholder="pnpm, strict TypeScript, no ORM — raw SQL is fine"
      />
    </label>
  </div>
</template>
