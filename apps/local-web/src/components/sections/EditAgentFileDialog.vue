<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useWriteAgentFile } from "../../composables/agents/use-agent-mutations.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { slugifyRuleName } from "./rule-name-slug.js";
import type { SectionScope } from "./section-scope.js";

// A hand-authored agent file — a plain Claude Code subagent the user keeps
// as a file, not a Vynel agent. Edited raw (frontmatter + prompt) because
// the file is theirs and may carry keys Vynel does not model. The name is
// the file stem and is fixed after creation.
const props = defineProps<{
  open: boolean;
  scope: SectionScope;
  /** A file to edit; null/absent = write a new one. */
  editing?: { slug: string; content: string } | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const name = ref("");
const content = ref("");
const writeFile = useWriteAgentFile();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.editing?.slug ?? "";
    content.value = props.editing?.content ?? "";
    writeFile.reset();
  },
  { immediate: true },
);

const slug = computed(() =>
  props.editing ? props.editing.slug : slugifyRuleName(name.value),
);

// A fresh file opens with the block Claude Code needs, already naming the
// file — the person fills in the description and the prompt.
watch(slug, (next) => {
  if (props.editing || content.value.trim().length > 0 || next.length === 0) return;
  content.value = `---\nname: ${next}\ndescription: \n---\n\n`;
});

const canSubmit = computed(
  () => slug.value.length > 0 && content.value.trim().length > 0 && !writeFile.isPending.value,
);

const errorMessage = computed(() =>
  writeFile.error.value ? formatSdkError(writeFile.error.value) : null,
);

function submit() {
  if (!canSubmit.value) return;
  writeFile.mutate(
    {
      slug: slug.value,
      body:
        props.scope.kind === "workspace"
          ? { scope: "workspace", workspaceId: props.scope.workspaceId, content: content.value }
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
    :title="props.editing ? 'Edit agent file' : 'Write an agent file'"
    description="A plain Claude Code subagent kept as a file — frontmatter (name, description, tools, model) then its prompt."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">File name</span>
        <input
          v-model="name"
          type="text"
          maxlength="120"
          :disabled="props.editing !== null && props.editing !== undefined"
          autofocus
          placeholder="e.g. code-reviewer"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3 disabled:opacity-60"
        />
        <span v-if="slug" class="text-[11px] text-ink-3"
          >Saved as <span class="font-mono">{{ slug }}.md</span></span
        >
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">File</span>
        <textarea
          v-model="content"
          rows="14"
          spellcheck="false"
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12px] leading-[1.5] text-ink-1 placeholder:text-ink-3"
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
        {{ writeFile.isPending.value ? "Saving…" : "Save file" }}
      </button>
    </template>
  </Modal>
</template>
