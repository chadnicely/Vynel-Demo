<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhCheck,
  PhMagnifyingGlass,
  PhMinus,
  PhPlus,
  PhX,
} from "@phosphor-icons/vue";
import { useWizardAnswers } from "./wizard-answers.js";
import type { RivalStudyOutcome } from "./wizard-study.js";
import {
  CARD,
  FIELD_LABEL,
  HINT,
  INPUT,
  KICKER,
  KICKER_GOLD,
  ROW_BUTTON,
  TICK_BOX,
  TICK_BOX_ON,
} from "./wizard-classes.js";

// Screen 5 — "Is there one like it already?". Site chips across the top, the
// study underneath: WHAT THEY DO as a searchable tick-list, WHAT WOULD MAKE
// YOURS MAGICAL as tick cards, and what we would leave out. The study is the
// model's own knowledge of the site — labeled as exactly that, never a
// pretend live analysis.
const props = defineProps<{ studies: Record<string, RivalStudyOutcome> }>();

const emit = defineEmits<{ study: []; remove: [site: string] }>();

const answers = useWizardAnswers();

const activeSite = ref(0);
const isAdding = ref(false);
const featureQuery = ref("");

const site = computed(() => answers.rivals[activeSite.value] ?? null);
const study = computed(() =>
  site.value === null ? null : (props.studies[site.value] ?? null),
);
const showField = computed(() => answers.rivals.length === 0 || isAdding.value);

const shownFeatures = computed(() => {
  if (study.value?.state !== "ready") return [];
  const query = featureQuery.value.trim().toLowerCase();
  return study.value.whatTheyDo.filter(
    (line) => query === "" || line.toLowerCase().includes(query),
  );
});

const tickedHere = computed(() => {
  const from = site.value;
  if (from === null) return "";
  const count = answers.wants.filter((want) => want.from === from).length;
  return count > 0 ? `${count} ticked here` : "";
});

function selectSite(index: number) {
  activeSite.value = index;
  isAdding.value = false;
  featureQuery.value = "";
}

function removeSite(url: string) {
  emit("remove", url);
  activeSite.value = 0;
}

function isWanted(text: string): boolean {
  return answers.wants.some((want) => want.text === text);
}

function toggleWant(text: string) {
  const from = site.value ?? "them";
  const at = answers.wants.findIndex((want) => want.text === text);
  if (at >= 0) answers.wants.splice(at, 1);
  else answers.wants.push({ text, from });
}

// A freshly-added site becomes the active tab, so its reading state plays
// out in front of the user instead of behind an unselected chip.
watch(
  () => answers.rivals.length,
  (next, previous) => {
    if (next > (previous ?? 0)) selectSite(next - 1);
  },
);
</script>

<template>
  <div
    v-if="answers.rivals.length > 0"
    class="flex flex-wrap items-center gap-1.5"
  >
    <span
      v-for="(url, index) in answers.rivals"
      :key="url"
      class="inline-flex items-center overflow-hidden rounded-full border"
      :class="
        index === activeSite
          ? 'border-gold bg-gold-soft'
          : 'border-hair-strong bg-panel'
      "
    >
      <button
        type="button"
        class="cursor-default px-3 py-1 text-[12px] text-ink-1"
        :aria-pressed="index === activeSite"
        @click="selectSite(index)"
      >
        {{ url }}
      </button>
      <button
        type="button"
        class="cursor-default pr-2 text-ink-3 hover:text-ink-1"
        :title="`Remove ${url}`"
        :aria-label="`Remove ${url}`"
        @click="removeSite(url)"
      >
        <PhX :size="11" />
      </button>
    </span>
    <button
      type="button"
      class="inline-flex cursor-default items-center gap-1 rounded-full border border-dashed border-hair-strong px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink-1"
      :class="{ 'border-gold text-ink-1': isAdding }"
      :aria-pressed="isAdding"
      @click="isAdding = true"
    >
      <PhPlus :size="12" /> Add
    </button>
  </div>

  <label v-if="showField" class="grid gap-1.5">
    <span :class="FIELD_LABEL">{{
      answers.rivals.length === 0
        ? "A website like the one you want"
        : "Another one to look at"
    }}</span>
    <input
      v-model="answers.rivalDraft"
      type="text"
      placeholder="opentable.com"
      spellcheck="false"
      :class="INPUT"
      @keydown.enter.prevent="emit('study')"
    />
  </label>

  <div
    v-if="study?.state === 'loading'"
    class="flex items-center gap-2.5 text-[12.5px] text-ink-2"
  >
    <span class="size-2 animate-pulse rounded-full bg-gold" />
    <span>Thinking through what {{ site }} does — a moment.</span>
  </div>

  <p
    v-else-if="study?.state === 'failed'"
    class="m-0 text-[12.5px] leading-relaxed text-ink-2"
  >
    We couldn't put together what {{ site }} does just now. Carry on — your own
    answers are enough, and you can try it again later.
  </p>

  <template v-else-if="study?.state === 'ready'">
    <p class="m-0 text-[11.5px] italic text-ink-3">
      From what Claude already knows of {{ site }} — not a live read of the page
      today.
    </p>

    <div class="grid gap-2">
      <div class="flex items-baseline gap-2.5">
        <span :class="KICKER">What they do</span>
        <span :class="HINT">Tick anything you want yours to do</span>
        <span class="flex-1" />
        <span v-if="tickedHere" class="text-[11px] text-gold">{{
          tickedHere
        }}</span>
      </div>
      <div :class="CARD" class="grid gap-2 p-2">
        <div class="flex items-center gap-2 px-1.5 text-ink-3">
          <PhMagnifyingGlass :size="13" />
          <input
            v-model="featureQuery"
            class="min-w-0 flex-1 bg-transparent text-[12px] text-ink-1 placeholder:text-ink-3 focus:outline-none"
            :placeholder="`Search ${study.whatTheyDo.length} things they do…`"
            aria-label="Search what they do"
          />
          <span class="text-[11px]"
            >{{ shownFeatures.length }} of {{ study.whatTheyDo.length }}</span
          >
        </div>
        <div class="max-h-56 overflow-y-auto">
          <button
            v-for="line in shownFeatures"
            :key="line"
            type="button"
            :class="ROW_BUTTON"
            :aria-pressed="isWanted(line)"
            @click="toggleWant(line)"
          >
            <span :class="[TICK_BOX, isWanted(line) ? TICK_BOX_ON : '']">
              <PhCheck v-if="isWanted(line)" :size="11" weight="bold" />
            </span>
            <span>{{ line }}</span>
          </button>
          <span
            v-if="shownFeatures.length === 0"
            class="block px-2.5 py-2 text-[12px] text-ink-3"
          >
            Nothing matches that.
          </span>
        </div>
      </div>
    </div>

    <div class="grid gap-1.5">
      <span :class="KICKER_GOLD">What would make yours magical</span>
      <button
        v-for="idea in study.magic"
        :key="idea.title"
        type="button"
        :class="[ROW_BUTTON, CARD, 'items-start']"
        :aria-pressed="isWanted(idea.title)"
        @click="toggleWant(idea.title)"
      >
        <span
          :class="[TICK_BOX, 'mt-0.5', isWanted(idea.title) ? TICK_BOX_ON : '']"
        >
          <PhCheck v-if="isWanted(idea.title)" :size="11" weight="bold" />
        </span>
        <span class="leading-relaxed">
          <strong class="font-semibold">{{ idea.title }}</strong> —
          <span class="text-ink-2">{{ idea.why }}</span>
        </span>
      </button>
    </div>

    <div v-if="study.leaveOut.length > 0" class="grid gap-1">
      <span :class="KICKER">What we would leave out</span>
      <p
        v-for="line in study.leaveOut"
        :key="line"
        class="m-0 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2"
      >
        <PhMinus :size="13" class="mt-1 shrink-0 text-ink-3" />
        <span>{{ line }}</span>
      </p>
    </div>
  </template>

  <p v-else class="m-0 text-[12.5px] leading-relaxed text-ink-3">
    Haven't got one in mind? Carry on — we'll work from your own answers
    instead.
  </p>
</template>
