<script setup lang="ts">
import { useWizardAnswers } from "./wizard-answers.js";
import { FIELD_LABEL, HINT, INPUT } from "./wizard-classes.js";

// Screen 9 — a name, and only a name (Chad, 2026-08-24: "reverse his rule...
// it's too hard for people"). The folder is minted from the name inside the
// user's projects folder by the engine on Finish, and is never shown: picking
// a path was the single hardest thing this wizard asked of a non-technical
// person, and showing one here would also make "nothing you already have is
// ever moved" read as a claim about where everything lives.
//
// The folder picker survives on the PULL-IN path only, where the user really
// is pointing at a folder that already exists (`WhichProjectDialog`).
defineProps<{ active: boolean }>();

const answers = useWizardAnswers();
</script>

<template>
  <label class="grid gap-1.5">
    <span :class="FIELD_LABEL">What are we calling it?</span>
    <input
      v-model="answers.appName"
      type="text"
      maxlength="120"
      placeholder="Bookkeeping, My Shop, the band site…"
      :class="INPUT"
    />
    <span :class="HINT">
      Vynel makes a folder for it in your workspace. Nothing of yours moves.
    </span>
  </label>
</template>
