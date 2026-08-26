<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useCreateSkill } from "../../composables/skills/use-create-skill.js";
import { skillScopeOf } from "../../composables/skills/skill-scope.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { slugifySkillName } from "./skill-name-slug.js";
import type { SectionScope } from "./section-scope.js";

// Write a NEW skill of the user's own — a folder Claude opens when a task
// matches its description. Three parts: the name (becomes the folder), the
// one-line description (the trigger — it is how Claude decides to use the
// skill), and the instructions. Supporting files come after, in the
// skill's file editor.
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  saved: [skillId: string];
}>();

const name = ref("");
const description = ref("");
const body = ref("");

const createSkill = useCreateSkill();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = "";
    description.value = "";
    body.value = "";
    createSkill.reset();
  },
  { immediate: true },
);

const skillId = computed(() => slugifySkillName(name.value));

const canSubmit = computed(
  () =>
    skillId.value.length > 0 &&
    description.value.trim().length > 0 &&
    body.value.trim().length > 0 &&
    !createSkill.isPending.value,
);

const errorMessage = computed(() =>
  createSkill.error.value ? formatSdkError(createSkill.error.value) : null,
);

function submit() {
  if (!canSubmit.value) return;
  const id = skillId.value;
  createSkill.mutate(
    {
      ...skillScopeOf(props.defaultScope),
      skillId: id,
      description: description.value.trim(),
      body: body.value,
    },
    { onSuccess: () => emit("saved", id) },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Write a skill"
    description="Something Claude knows how to do — it opens the skill when a task matches the description."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="name"
          type="text"
          maxlength="64"
          autofocus
          placeholder="e.g. Weekly report"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
        <span v-if="skillId" class="text-[11px] text-ink-3"
          >Saved as <span class="font-mono">{{ skillId }}/SKILL.md</span></span
        >
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2"
          >When to use it</span
        >
        <input
          v-model="description"
          type="text"
          maxlength="1024"
          placeholder="One line — e.g. Use when asked to write the Friday team update"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Instructions</span>
        <textarea
          v-model="body"
          rows="10"
          placeholder="Markdown works. Step by step, how you like it done. You can add reference files after saving."
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ createSkill.isPending.value ? "Saving…" : "Save skill" }}
      </button>
    </template>
  </Modal>
</template>
