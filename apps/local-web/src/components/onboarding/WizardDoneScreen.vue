<script setup lang="ts">
import { ref } from "vue";

// The finish line, in two beats (Chad, 2026-08-24):
//   1. Congratulations — setup is done, and it should feel done. The fireworks
//      belong to the BACKDROP (`WizardFireworks`, mounted behind the card by
//      `OnboardingWizard`), not to this card.
//   2. The one question the "+" popup used to ask every single time: something
//      new, or something you already have? Asked ONCE, here — the answer sends
//      them to the build wizard or the folder picker.
const props = defineProps<{
  displayName: string | null;
}>();

const emit = defineEmits<{
  /** The user picked a door — the shell opens it. */
  open: [choice: "new" | "existing"];
  /** Left the congratulations beat — the celebration stops here (Chad,
   *  2026-08-24): fireworks behind a question is noise, not celebration. */
  choosing: [];
}>();

const isChoosing = ref(false);

function startChoosing() {
  isChoosing.value = true;
  emit("choosing");
}
</script>

<template>
  <div class="done">
    <template v-if="!isChoosing">
      <h1 class="done-title">
        Congratulations<template v-if="props.displayName"
          >, {{ props.displayName }}</template
        >!
      </h1>
      <p class="done-body">
        Your Vynel account is all set up. Now let's go build the magic.
      </p>
      <button type="button" class="open-app" @click="startChoosing">
        Open Vynel
      </button>
    </template>

    <template v-else>
      <h1 class="done-title">What are we starting with?</h1>
      <p class="done-body">Either way it ends up on your screen the same.</p>

      <div class="doors">
        <button type="button" class="door" @click="emit('open', 'new')">
          <span class="door-title">Something new</span>
          <span class="door-body">
            Tell Vynel the idea. It asks a few questions, plans the whole
            thing, and builds it in steps you approve.
          </span>
        </button>

        <button type="button" class="door" @click="emit('open', 'existing')">
          <span class="door-title">Something I already have</span>
          <span class="door-body">
            Point at a project anywhere on this computer. It stays exactly
            where it is — nothing gets moved.
          </span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.done {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 8px;
  text-align: center;
  padding: 26px 8px 18px;
}

.done-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 20px/1.35 var(--font-ui);
}

.done-body {
  margin: 0 0 12px;
  max-width: 380px;
  color: var(--ink-2);
  font: 400 13px/1.6 var(--font-ui);
}

.open-app {
  appearance: none;
  border: 0;
  border-radius: var(--radius-s);
  padding: 9px 26px;
  background: var(--gold);
  color: var(--color-bg);
  font: 600 13.5px/1.6 var(--font-ui);
  transition: background var(--t-fast) var(--ease-out);
}

.open-app:hover {
  background: var(--gold-bright);
}

.doors {
  display: grid;
  gap: 10px;
  width: 100%;
  max-width: 420px;
  text-align: left;
}

.door {
  appearance: none;
  display: grid;
  gap: 4px;
  padding: 14px;
  /* A <button> centres its text by UA default — the wrapper's text-align
     never reaches in here, so say it on the button itself. */
  text-align: left;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  transition:
    border-color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out);
}

.door:hover {
  border-color: var(--gold);
  background: var(--bg-panel);
}

.door:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

.door-title {
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.door-body {
  color: var(--ink-3);
  font: 400 12px/1.55 var(--font-ui);
}
</style>
