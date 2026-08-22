<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhCaretDown,
  PhCaretUp,
  PhCheckCircle,
  PhCircleDashed,
  PhThumbsUp,
} from "@phosphor-icons/vue";
import type { WorkspacePlan } from "@vynel/contracts/workspaces/workspace-brief";
import { useWizardAnswers } from "./wizard-answers.js";
import { CARD, HINT, KICKER, PRIMARY_BUTTON } from "./wizard-classes.js";

// Screen 12 — how we will build it: the MVP broken into sessions, in order,
// each an accordion of its items, all "Waiting for your approval" until the
// one approval covers the lot. Nothing shows as running or done — nothing
// is, and we don't pretend.
const props = defineProps<{ plan: WorkspacePlan }>();

const answers = useWizardAnswers();

const tab = ref(0);
const openSession = ref<number | null>(0);

const mvp = computed(() =>
  props.plan.sessions.filter((session) => session.mvp),
);
const rest = computed(() =>
  props.plan.sessions.filter((session) => !session.mvp),
);
const shown = computed(() => (tab.value === 0 ? mvp.value : rest.value));

function showTab(index: number) {
  tab.value = index;
  openSession.value = index === 0 ? 0 : null;
}

function approveAll() {
  answers.planApproved = true;
}
</script>

<template>
  <div class="flex items-center gap-2.5">
    <span class="h-1 flex-1 overflow-hidden rounded-full bg-hair">
      <span class="block h-full w-0 bg-gold" />
    </span>
    <span class="text-[11px] text-ink-3"
      >{{ mvp.length }} sessions in the MVP</span
    >
  </div>

  <div class="flex gap-1 border-b border-hair" role="tablist">
    <button
      type="button"
      role="tab"
      class="-mb-px cursor-default border-b-2 px-2.5 pb-2 pt-1 text-[12.5px] transition"
      :class="
        tab === 0
          ? 'border-gold text-ink-1'
          : 'border-transparent text-ink-3 hover:text-ink-1'
      "
      :aria-selected="tab === 0"
      @click="showTab(0)"
    >
      The MVP <span class="text-ink-3">· 0/{{ mvp.length }}</span>
    </button>
    <button
      type="button"
      role="tab"
      class="-mb-px cursor-default border-b-2 px-2.5 pb-2 pt-1 text-[12.5px] transition"
      :class="
        tab === 1
          ? 'border-gold text-ink-1'
          : 'border-transparent text-ink-3 hover:text-ink-1'
      "
      :aria-selected="tab === 1"
      @click="showTab(1)"
    >
      After the MVP <span class="text-ink-3">· {{ rest.length }}</span>
    </button>
  </div>

  <span :class="HINT">{{
    tab === 0
      ? "Every one of these has to be right before anything else starts."
      : "The nice-to-haves. They wait until the MVP is yours and being used."
  }}</span>

  <div class="grid gap-1.5">
    <div
      v-for="(session, index) in shown"
      :key="session.name"
      :class="CARD"
      class="p-0"
    >
      <button
        type="button"
        class="flex w-full cursor-default items-center gap-2.5 px-3.5 py-2.5 text-left"
        :aria-expanded="openSession === index"
        @click="openSession = openSession === index ? null : index"
      >
        <span
          class="grid size-5 shrink-0 place-items-center rounded-full border border-hair-strong text-[10.5px] text-ink-2"
        >
          {{ index + 1 }}
        </span>
        <span class="grid min-w-0 flex-1 gap-0.5">
          <span class="text-[12.5px] text-ink-1">{{ session.name }}</span>
          <span class="text-[11px] text-ink-3">{{
            answers.planApproved
              ? "Approved — ready to run"
              : "Waiting for your approval"
          }}</span>
        </span>
        <span class="text-[11px] text-ink-3">
          {{ session.items.length }}
          {{ session.items.length === 1 ? "thing" : "things" }}
        </span>
        <PhCaretUp v-if="openSession === index" :size="13" class="text-ink-3" />
        <PhCaretDown v-else :size="13" class="text-ink-3" />
      </button>
      <div
        v-if="openSession === index"
        class="grid gap-1 border-t border-hair px-3.5 py-2.5"
      >
        <p
          v-for="item in session.items"
          :key="item"
          class="m-0 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2"
        >
          <PhCircleDashed :size="14" class="mt-0.5 shrink-0 text-ink-3" />
          <span>{{ item }}</span>
        </p>
      </div>
    </div>
  </div>

  <div :class="CARD" class="flex items-center gap-3">
    <span class="grid min-w-0 flex-1 gap-0.5">
      <span :class="KICKER">{{
        answers.planApproved
          ? "Plan approved — the sessions can run"
          : "Happy with this plan?"
      }}</span>
      <span class="text-[12px] leading-relaxed text-ink-2">{{
        answers.planApproved
          ? "We work through them in order and show you each one on your computer as it lands."
          : "Open any session above to see what is in it. One approval covers the lot."
      }}</span>
    </span>
    <button
      type="button"
      :class="PRIMARY_BUTTON"
      :disabled="answers.planApproved"
      @click="approveAll"
    >
      <PhCheckCircle v-if="answers.planApproved" :size="14" />
      <PhThumbsUp v-else :size="14" />
      {{ answers.planApproved ? "Approved" : "I approve the plan" }}
    </button>
  </div>
</template>
