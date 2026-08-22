<script setup lang="ts">
import { computed, ref } from "vue";
import { PhCheck, PhPlus, PhX } from "@phosphor-icons/vue";
import { useWizardAnswers } from "./wizard-answers.js";
import { INPUT, KICKER, KICKER_GOLD, SMALL_BUTTON } from "./wizard-classes.js";

// Screen 6 — everything they liked, in one place: the ticks grouped by the
// site they came from, each removable, plus the free-add box.
const answers = useWizardAnswers();

const draft = ref("");

const groups = computed(() => {
  const byFrom = new Map<string, string[]>();
  for (const want of answers.wants) {
    const items = byFrom.get(want.from) ?? [];
    items.push(want.text);
    byFrom.set(want.from, items);
  }
  return [...byFrom.entries()].map(([from, items]) => ({ from, items }));
});

function remove(text: string) {
  const at = answers.wants.findIndex((want) => want.text === text);
  if (at >= 0) answers.wants.splice(at, 1);
}

function add() {
  const text = draft.value.trim();
  if (text.length < 3) return;
  answers.wants.push({ text, from: "you" });
  draft.value = "";
}
</script>

<template>
  <p
    v-if="answers.wants.length === 0"
    class="m-0 text-[12.5px] leading-relaxed text-ink-3"
  >
    You did not tick anything from the sites you looked at — that is fine. Add
    anything you want here, or carry on.
  </p>

  <div v-for="group in groups" :key="group.from" class="grid gap-1">
    <span :class="KICKER">From {{ group.from }}</span>
    <div
      v-for="text in group.items"
      :key="text"
      class="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[12.5px] text-ink-1 hover:bg-row-hover"
    >
      <PhCheck :size="14" class="shrink-0 text-gold" />
      <span class="flex-1">{{ text }}</span>
      <button
        type="button"
        class="cursor-default text-ink-3 hover:text-ink-1"
        title="Take it off the list"
        aria-label="Take it off the list"
        @click="remove(text)"
      >
        <PhX :size="13" />
      </button>
    </div>
  </div>

  <div class="grid gap-1.5">
    <span :class="KICKER_GOLD">Anything else you want</span>
    <div class="flex items-center gap-2">
      <input
        v-model="draft"
        type="text"
        :class="INPUT"
        placeholder="Let people leave a note with their booking"
        aria-label="Anything else you want"
        @keydown.enter.prevent="add"
      />
      <button
        type="button"
        :class="SMALL_BUTTON"
        :disabled="draft.trim().length < 3"
        @click="add"
      >
        <PhPlus :size="13" /> Add
      </button>
    </div>
  </div>
</template>
