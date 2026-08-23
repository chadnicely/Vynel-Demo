<script setup lang="ts">
import {
  PhArrowBendDownLeft,
  PhArrowRight,
  PhChatCircle,
  PhCheckCircle,
  PhFlask,
  PhHammer,
  PhMagnifyingGlass,
  PhThumbsUp,
  PhWarning,
} from "@phosphor-icons/vue";
import { CARD, KICKER } from "./wizard-classes.js";

// The Done screen — what happens from here: the Build → Test → Feedback →
// Check → Approval loop every session follows, the road past the MVP, and
// what ACTUALLY happened when Finish made the workspace (the folder, git —
// shown, never assumed).
defineProps<{
  folderPath: string | null;
  git:
    | { kind: "initialized" }
    | { kind: "existing" }
    | { kind: "skipped"; reason: string }
    | null;
}>();

const LOOP = [
  { label: "Build", icon: PhHammer },
  { label: "Test", icon: PhFlask },
  { label: "Feedback", icon: PhChatCircle },
  { label: "Check", icon: PhMagnifyingGlass },
  { label: "Approval", icon: PhThumbsUp },
];

const ROADMAP = [
  {
    title: "Get the MVP done",
    when: "now",
    bullets: [
      "The sessions you just approved, one after another",
      "It runs on your computer first — yours to poke at",
      "Nothing goes public until you say so",
    ],
  },
  {
    title: "Put it in front of real people",
    when: "next",
    bullets: [
      "A proper web address, so it is not just on your machine",
      "Invite a handful of people who will actually use it",
      "Watch what they do — where they hesitate is the real feedback",
    ],
  },
  {
    title: "Keep building it out",
    when: "ongoing",
    bullets: [
      "What they told you becomes the next round of sessions",
      "Everything on your Later list is still here, waiting",
      "Same loop: build, test, feedback, check, approve",
    ],
  },
  {
    title: "Start on the marketing",
    when: "once it holds up",
    bullets: [
      "Say plainly what it does and who it is for",
      "A page people can land on and understand in ten seconds",
      "Somewhere to collect the ones who are interested but not ready",
    ],
  },
];

const FORGOTTEN = [
  "A web address of your own",
  "Who else can sign in",
  "Taking real payments",
  "Privacy and terms pages",
  "Someone watching it stays up",
  "Somewhere for people to get help",
];
</script>

<template>
  <div v-if="folderPath" :class="CARD" class="grid gap-1.5">
    <p class="m-0 flex items-start gap-2 text-[12.5px] text-ink-1">
      <PhCheckCircle
        :size="14"
        class="mt-0.5 shrink-0 text-gold"
        weight="fill"
      />
      <span>
        The workspace is made —
        <code class="rounded-sm bg-raised px-1.5 py-0.5 text-[11.5px]">{{
          folderPath
        }}</code>
        <template v-if="git?.kind === 'initialized'"
          >, first commit in.</template
        >
        <template v-else-if="git?.kind === 'existing'"
          >, its history kept as it was.</template
        >
        <template v-else>.</template>
      </span>
    </p>
    <p
      v-if="git?.kind === 'skipped'"
      class="m-0 flex items-start gap-2 text-[12px] text-needs-input"
    >
      <PhWarning :size="14" class="mt-0.5 shrink-0" />
      <span>{{ git.reason }}</span>
    </p>
  </div>

  <div class="grid gap-2">
    <span :class="KICKER">What every session looks like</span>
    <div class="flex flex-wrap items-center gap-1.5">
      <span
        v-for="(stage, index) in LOOP"
        :key="stage.label"
        class="flex items-center gap-1.5"
      >
        <span
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]"
          :class="
            index === LOOP.length - 1
              ? 'border-gold bg-gold-soft text-ink-1'
              : 'border-hair-strong bg-panel text-ink-2'
          "
        >
          <component :is="stage.icon" :size="12" /> {{ stage.label }}
        </span>
        <PhArrowBendDownLeft
          v-if="index === LOOP.length - 1"
          :size="11"
          class="text-ink-3"
        />
        <PhArrowRight v-else :size="11" class="text-ink-3" />
      </span>
    </div>
    <p class="m-0 text-[11.5px] text-ink-3">
      Once you approve, the next session starts. Same five steps, every time.
    </p>
  </div>

  <div class="grid gap-3">
    <div
      v-for="(phase, index) in ROADMAP"
      :key="phase.title"
      class="flex gap-3"
    >
      <span class="flex flex-col items-center">
        <span
          class="grid size-5 shrink-0 place-items-center rounded-full border text-[10.5px]"
          :class="
            index === 0
              ? 'border-gold bg-gold text-shell'
              : 'border-hair-strong text-ink-2'
          "
        >
          {{ index + 1 }}
        </span>
        <span
          v-if="index < ROADMAP.length - 1"
          class="mt-1 w-px flex-1 bg-hair"
        />
      </span>
      <span class="grid flex-1 gap-1 pb-1">
        <span class="flex items-baseline gap-2">
          <span class="text-[12.5px] text-ink-1">{{ phase.title }}</span>
          <span class="text-[11px] text-ink-3">{{ phase.when }}</span>
        </span>
        <p
          v-for="bullet in phase.bullets"
          :key="bullet"
          class="m-0 flex items-start gap-2 text-[12px] leading-relaxed text-ink-2"
        >
          <span
            class="mt-[7px] size-1.5 shrink-0 rounded-full bg-hair-strong"
          />
          <span>{{ bullet }}</span>
        </p>
      </span>
    </div>
  </div>

  <div class="grid gap-1.5">
    <span class="text-[11.5px] text-ink-3"
      >Easy to forget — we will bring these up when they matter</span
    >
    <div class="flex flex-wrap gap-1.5">
      <span
        v-for="entry in FORGOTTEN"
        :key="entry"
        class="rounded-full border border-hair-strong px-2.5 py-0.5 text-[11.5px] text-ink-2"
      >
        {{ entry }}
      </span>
    </div>
  </div>
</template>
