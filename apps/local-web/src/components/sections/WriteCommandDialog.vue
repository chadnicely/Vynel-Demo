<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useWriteCommand } from "../../composables/commands/use-write-command.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { slugifyCommandName } from "./command-name-slug.js";
import type { SectionScope } from "./section-scope.js";

// Write (or edit) one of the user's OWN slash commands — a reusable prompt
// Claude runs when they type "/name". The file is the record: the name
// becomes `<name>.md` (a ":" makes a folder) and is fixed after creation
// (delete + recreate to rename); the engine renders the description and
// argument hint into the file's frontmatter and keeps any other key a
// hand-authored file carried.
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
  /** A command to edit; null/absent = write a new one. */
  editing?: {
    commandName: string;
    description: string | null;
    argumentHint: string | null;
    body: string;
  } | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const name = ref("");
const description = ref("");
const argumentHint = ref("");
const body = ref("");

const writeCommand = useWriteCommand();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.editing?.commandName ?? "";
    description.value = props.editing?.description ?? "";
    argumentHint.value = props.editing?.argumentHint ?? "";
    body.value = props.editing?.body ?? "";
    writeCommand.reset();
  },
  { immediate: true },
);

const commandName = computed(() =>
  props.editing ? props.editing.commandName : slugifyCommandName(name.value),
);

const canSubmit = computed(
  () =>
    commandName.value.length > 0 &&
    body.value.trim().length > 0 &&
    !writeCommand.isPending.value,
);

const errorMessage = computed(() =>
  writeCommand.error.value ? formatSdkError(writeCommand.error.value) : null,
);

function submit() {
  if (!canSubmit.value) return;
  const parts = {
    description: description.value.trim() || null,
    argumentHint: argumentHint.value.trim() || null,
    body: body.value,
  };
  writeCommand.mutate(
    {
      commandName: commandName.value,
      body:
        props.defaultScope.kind === "workspace"
          ? {
              scope: "workspace",
              workspaceId: props.defaultScope.workspaceId,
              ...parts,
            }
          : { scope: "user", ...parts },
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
    :title="props.editing ? 'Edit command' : 'Write a command'"
    description="A reusable prompt Claude runs when you type its name after a slash."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="name"
          type="text"
          maxlength="120"
          :disabled="props.editing !== null && props.editing !== undefined"
          autofocus
          placeholder="e.g. weekly-report, or git:commit to group it"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3 disabled:opacity-60"
        />
        <span v-if="commandName" class="text-[11px] text-ink-3"
          >Runs as <span class="font-mono">/{{ commandName }}</span></span
        >
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Description</span>
        <input
          v-model="description"
          type="text"
          maxlength="300"
          placeholder="One line shown in the / menu"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2"
          >Arguments <span class="font-normal text-ink-3">(optional)</span></span
        >
        <input
          v-model="argumentHint"
          type="text"
          maxlength="120"
          placeholder="e.g. [customer name]"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Prompt</span>
        <textarea
          v-model="body"
          rows="9"
          placeholder="What Claude should do when this runs. Write $ARGUMENTS where what you type after the name should go."
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
        {{ writeCommand.isPending.value ? "Saving…" : "Save command" }}
      </button>
    </template>
  </Modal>
</template>
