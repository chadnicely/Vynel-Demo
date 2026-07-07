<script setup lang="ts">
import { computed, ref } from "vue";
import type { InstallSuggestedSkillsStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import type { OnboardingSnapshot } from "../../../composables/onboarding/use-onboarding-run.js";
import StepActions from "../StepActions.vue";

const props = defineProps<{
  busy?: boolean;
  // Derived from the wire so drift in the snapshot shape surfaces here.
  suggestedSkills?: OnboardingSnapshot["suggestedSkills"];
}>();

const emit = defineEmits<{
  submit: [input: InstallSuggestedSkillsStepInput];
}>();

const recommended = computed(
  () => props.suggestedSkills?.defaultCheckedSkillIds ?? [],
);
const optional = computed(() => props.suggestedSkills?.optionalSkillIds ?? []);

const checkedIds = ref(new Set<string>(recommended.value));

function toggle(skillId: string) {
  const next = new Set(checkedIds.value);
  if (next.has(skillId)) next.delete(skillId);
  else next.add(skillId);
  checkedIds.value = next;
}

/** "daily-briefing" → "Daily briefing" — the only label source available
 *  during onboarding (the first-launch gate blocks the catalog routes). */
function labelFor(skillId: string): string {
  const words = skillId.replace(/[-_]+/g, " ").trim();
  return words.length > 0
    ? words.charAt(0).toUpperCase() + words.slice(1)
    : skillId;
}

function submit() {
  emit("submit", { skillIdsToInstall: [...checkedIds.value] });
}
</script>

<template>
  <form @submit.prevent="submit">
    <p class="explain">
      Skills are ready-made abilities — pick a starting set. Everything stays
      installable later from the marketplace.
    </p>

    <p
      v-if="recommended.length === 0 && optional.length === 0"
      class="no-suggestions"
    >
      No suggestions for this setup — you can browse the marketplace once
      you're in.
    </p>

    <div v-else class="skill-groups">
      <fieldset v-if="recommended.length > 0" class="skill-group">
        <legend>Recommended</legend>
        <label v-for="skillId in recommended" :key="skillId" class="skill-row">
          <input
            type="checkbox"
            :checked="checkedIds.has(skillId)"
            @change="toggle(skillId)"
          />
          <span class="skill-name">{{ labelFor(skillId) }}</span>
        </label>
      </fieldset>

      <fieldset v-if="optional.length > 0" class="skill-group">
        <legend>Also available</legend>
        <label v-for="skillId in optional" :key="skillId" class="skill-row">
          <input
            type="checkbox"
            :checked="checkedIds.has(skillId)"
            @change="toggle(skillId)"
          />
          <span class="skill-name">{{ labelFor(skillId) }}</span>
        </label>
      </fieldset>
    </div>

    <StepActions
      :primary-label="
        checkedIds.size > 0
          ? `Install ${checkedIds.size} skill${checkedIds.size === 1 ? '' : 's'}`
          : 'Continue without skills'
      "
      :busy="props.busy"
    />
  </form>
</template>

<!-- .explain is styled by WizardStepBody (the one home for step-shared
     presentation). -->
<style scoped>
.no-suggestions {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--hair-strong);
  border-radius: var(--radius-m);
  color: var(--ink-3);
  font: 400 12.5px/1.6 var(--font-ui);
}

.skill-groups {
  display: grid;
  gap: 14px;
}

.skill-group {
  margin: 0;
  padding: 10px 12px 12px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  display: grid;
  gap: 6px;
}

.skill-group legend {
  padding: 0 6px;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.skill-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-s);
}

.skill-row:hover {
  background: var(--row-hover);
}

.skill-row input {
  accent-color: var(--gold);
}

.skill-name {
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
}
</style>
