<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useWriteRule } from "../../composables/rules/use-write-rule.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { slugifyRuleName } from "./rule-name-slug.js";
import type { SectionScope } from "./section-scope.js";

// Write (or edit) one of the user's OWN rules — a standing instruction Claude
// follows in every session at that scope. The file is the record: the name
// becomes `<name>.md` in the scope's `.claude/rules` folder and is fixed
// after creation (delete + recreate to rename, the notebook's rule), and a
// save replaces the whole file. Editing a marketplace rule forks it — the
// dialog says so, because the "Managed by Vynel" chip will disappear.
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
  /** A rule to edit; null/absent = write a new one. */
  editing?: {
    ruleId: string;
    content: string;
    managedByMarketplace: boolean;
  } | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const name = ref("");
const content = ref("");

const writeRule = useWriteRule();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.editing?.ruleId ?? "";
    content.value = props.editing?.content ?? "";
    writeRule.reset();
  },
  { immediate: true },
);

// A name a person types becomes a file name — kebab-case keeps it readable
// in the folder and safe on every filesystem.
const ruleId = computed(() =>
  props.editing ? props.editing.ruleId : slugifyRuleName(name.value),
);

const canSubmit = computed(
  () =>
    ruleId.value.length > 0 &&
    content.value.trim().length > 0 &&
    !writeRule.isPending.value,
);

const errorMessage = computed(() =>
  writeRule.error.value ? formatSdkError(writeRule.error.value) : null,
);

function submit() {
  if (!canSubmit.value) return;
  writeRule.mutate(
    {
      ruleId: ruleId.value,
      body:
        props.defaultScope.kind === "workspace"
          ? {
              scope: "workspace",
              workspaceId: props.defaultScope.workspaceId,
              content: content.value,
            }
          : { scope: "user", content: content.value },
    },
    { onSuccess: () => emit("saved") },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="props.editing ? 'Edit rule' : 'Write a rule'"
    description="A standing instruction Claude follows in every conversation here — how you like things done."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="name"
          type="text"
          maxlength="80"
          :disabled="props.editing !== null && props.editing !== undefined"
          autofocus
          placeholder="e.g. Writing style"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3 disabled:opacity-60"
        />
        <span v-if="!props.editing && ruleId" class="text-[11px] text-ink-3"
          >Saved as <span class="font-mono">{{ ruleId }}.md</span></span
        >
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Rule</span>
        <textarea
          v-model="content"
          rows="10"
          placeholder="Markdown works. Start with a heading, then say what Claude should always do here."
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <p
        v-if="props.editing?.managedByMarketplace"
        class="fork-notice m-0 text-xs text-ink-3"
      >
        This rule came from the Marketplace. Saving makes it your own copy —
        Marketplace updates will no longer apply to it.
      </p>

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
        {{ writeRule.isPending.value ? "Saving…" : "Save rule" }}
      </button>
    </template>
  </Modal>
</template>
