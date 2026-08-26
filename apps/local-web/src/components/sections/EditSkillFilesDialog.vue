<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhFile as FileIcon,
  PhFilePlus as FilePlus,
  PhX as X,
} from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import { useSkillFiles } from "../../composables/skills/use-skill-files.js";
import {
  useDeleteSkillFile,
  useWriteSkillFile,
} from "../../composables/skills/use-skill-file-mutations.js";
import { skillScopeOf } from "../../composables/skills/skill-scope.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import CodeEditor from "../workspace/CodeEditor.vue";
import type { SectionScope } from "./section-scope.js";

// A skill is a FOLDER: SKILL.md plus whatever references, templates and
// scripts it ships. This is its editor — the file list on the left, one
// file open on the right, save per file. Add file writes an empty text file
// under the name typed (folders via "/"); delete removes a supporting file
// (never SKILL.md — that is the skill). Binary files are listed but never
// opened.
const props = defineProps<{
  open: boolean;
  scope: SectionScope;
  /** The skill being edited; null closes the editor. */
  skillId: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const SKILL_ENTRY_FILE = "SKILL.md";
const openPath = ref(SKILL_ENTRY_FILE);
const draft = ref("");
const newFileName = ref("");
const isAddingFile = ref(false);

const filesQuery = useSkillFiles({
  scope: () => props.scope,
  skillId: () => (props.open ? props.skillId : null),
  relativePath: openPath,
});
const files = computed(() => filesQuery.data.value?.files ?? []);
const openedContent = computed(() => filesQuery.data.value?.file.content ?? "");

// The draft follows the opened file; a save keeps the draft as the new
// baseline so "dirty" reads honestly.
watch(
  openedContent,
  (content) => {
    draft.value = content;
  },
  { immediate: true },
);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    openPath.value = SKILL_ENTRY_FILE;
    isAddingFile.value = false;
    newFileName.value = "";
  },
);

const isDirty = computed(() => draft.value !== openedContent.value);

const writeFile = useWriteSkillFile();
const deleteFile = useDeleteSkillFile();

const errorMessage = computed(() => {
  const error =
    writeFile.error.value ?? deleteFile.error.value ?? filesQuery.error.value;
  return error ? formatSdkError(error) : null;
});

// Unsaved edits never vanish under a click: switching files (or closing)
// while dirty parks the intent and asks — Save & continue, or Discard.
const pendingLeave = ref<{ kind: "open"; relativePath: string } | { kind: "close" } | null>(null);

function leaveTo(intent: NonNullable<typeof pendingLeave.value>) {
  if (intent.kind === "open") openPath.value = intent.relativePath;
  else emit("close");
}

function openFile(relativePath: string, isText: boolean) {
  if (!isText || relativePath === openPath.value) return;
  writeFile.reset();
  if (isDirty.value) {
    pendingLeave.value = { kind: "open", relativePath };
    return;
  }
  openPath.value = relativePath;
}

function requestClose() {
  if (isDirty.value) {
    pendingLeave.value = { kind: "close" };
    return;
  }
  emit("close");
}

function saveThenLeave() {
  const intent = pendingLeave.value;
  if (intent === null || props.skillId === null) return;
  writeFile.mutate(
    {
      skillId: props.skillId,
      body: {
        ...skillScopeOf(props.scope),
        relativePath: openPath.value,
        content: draft.value,
      },
    },
    {
      onSuccess: () => {
        pendingLeave.value = null;
        leaveTo(intent);
      },
    },
  );
}

function discardThenLeave() {
  const intent = pendingLeave.value;
  if (intent === null) return;
  pendingLeave.value = null;
  draft.value = openedContent.value;
  leaveTo(intent);
}

function save() {
  if (props.skillId === null || !isDirty.value) return;
  writeFile.mutate({
    skillId: props.skillId,
    body: {
      ...skillScopeOf(props.scope),
      relativePath: openPath.value,
      content: draft.value,
    },
  });
}

function addFile() {
  const relativePath = newFileName.value.trim().replace(/^\/+/, "");
  if (props.skillId === null || relativePath.length === 0) return;
  writeFile.mutate(
    {
      skillId: props.skillId,
      body: { ...skillScopeOf(props.scope), relativePath, content: "" },
    },
    {
      onSuccess: () => {
        isAddingFile.value = false;
        newFileName.value = "";
        openPath.value = relativePath;
      },
    },
  );
}

// Deleting a supporting file is gone-for-good — the same armed X the other
// shelves use: first click arms, second fires, blur disarms.
const armedDeletePath = ref<string | null>(null);

function requestDelete(relativePath: string) {
  if (props.skillId === null) return;
  if (armedDeletePath.value !== relativePath) {
    armedDeletePath.value = relativePath;
    return;
  }
  armedDeletePath.value = null;
  deleteFile.mutate(
    {
      skillId: props.skillId,
      query: { ...skillScopeOf(props.scope), relativePath },
    },
    {
      onSuccess: () => {
        if (openPath.value === relativePath) openPath.value = SKILL_ENTRY_FILE;
      },
    },
  );
}

function languageOf(relativePath: string): string {
  return relativePath.split(".").pop() ?? "md";
}

function onOpenChange(open: boolean) {
  if (!open) requestClose();
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="props.skillId ?? 'Skill'"
    description="The skill's files. Edit the instructions, or add reference files Claude can read alongside them."
    size="xl"
    @update:open="onOpenChange"
  >
    <div class="skill-editor grid min-h-[380px] grid-cols-[200px_1fr] gap-3">
      <aside class="file-list flex flex-col gap-1 border-r border-hair pr-3">
        <button
          v-for="file in files"
          :key="file.relativePath"
          type="button"
          class="file-row group flex cursor-default items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[12px] transition"
          :class="[
            file.relativePath === openPath
              ? 'bg-row-active text-ink-1'
              : 'text-ink-2 hover:bg-row-hover hover:text-ink-1',
            file.isText ? '' : 'opacity-60',
          ]"
          :title="file.isText ? file.relativePath : `${file.relativePath} (binary)`"
          @click="openFile(file.relativePath, file.isText)"
        >
          <FileIcon :size="13" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate font-mono">{{ file.relativePath }}</span>
          <span
            v-if="file.relativePath !== SKILL_ENTRY_FILE"
            role="button"
            tabindex="0"
            :class="
              armedDeletePath === file.relativePath
                ? 'delete-file is-danger shrink-0 rounded-full border border-danger/40 px-1.5 text-[10px] font-semibold text-danger'
                : 'delete-file shrink-0 rounded-sm p-0.5 text-ink-3 opacity-0 transition hover:text-danger group-hover:opacity-100'
            "
            :aria-label="
              armedDeletePath === file.relativePath
                ? `Confirm delete ${file.relativePath}`
                : `Delete ${file.relativePath}`
            "
            @click.stop="requestDelete(file.relativePath)"
            @blur="armedDeletePath = null"
            @keydown.enter.stop="requestDelete(file.relativePath)"
          >
            <template v-if="armedDeletePath === file.relativePath">Sure?</template>
            <X v-else :size="11" />
          </span>
        </button>

        <form
          v-if="isAddingFile"
          class="add-file mt-1 flex items-center gap-1"
          @submit.prevent="addFile"
        >
          <input
            v-model="newFileName"
            type="text"
            autofocus
            placeholder="references/notes.md"
            class="min-w-0 flex-1 rounded-sm border border-hair-strong bg-panel px-1.5 py-0.5 font-mono text-[11.5px] text-ink-1 placeholder:text-ink-3"
            @keydown.escape="isAddingFile = false"
          />
          <button
            type="submit"
            class="cursor-default rounded-sm bg-gold px-2 py-0.5 text-[11px] font-semibold text-shell"
          >
            Add
          </button>
        </form>
        <button
          v-else
          type="button"
          class="add-file-button mt-1 inline-flex cursor-default items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[12px] text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
          @click="isAddingFile = true"
        >
          <FilePlus :size="13" />
          Add a file
        </button>
      </aside>

      <section class="editor-pane flex min-w-0 flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate font-mono text-[12px] text-ink-2">{{ openPath }}</span>
          <button
            type="button"
            class="save-file cursor-default rounded-sm bg-gold px-3 py-1 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
            :disabled="!isDirty || writeFile.isPending.value"
            @click="save"
          >
            {{ writeFile.isPending.value ? "Saving…" : "Save file" }}
          </button>
        </div>
        <div class="min-h-[320px] flex-1 overflow-hidden rounded-sm border border-hair-strong bg-panel">
          <CodeEditor
            :key="`${props.skillId}:${openPath}`"
            v-model="draft"
            :language="languageOf(openPath)"
            placeholder="Empty file — type to fill it in."
          />
        </div>
        <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
          {{ errorMessage }}
        </p>
        <div
          v-if="pendingLeave !== null"
          class="unsaved-notice flex items-center gap-2 rounded-sm border border-gold/40 bg-gold/10 px-2.5 py-1.5 text-xs text-ink-1"
          role="alert"
        >
          <span class="flex-1">Unsaved changes in <span class="font-mono">{{ openPath }}</span>.</span>
          <button
            type="button"
            class="save-and-continue cursor-default rounded-sm bg-gold px-2.5 py-0.5 text-[11px] font-semibold text-shell"
            :disabled="writeFile.isPending.value"
            @click="saveThenLeave"
          >
            Save &amp; continue
          </button>
          <button
            type="button"
            class="discard-changes cursor-default rounded-sm border border-hair-strong px-2.5 py-0.5 text-[11px] font-semibold text-ink-2"
            @click="discardThenLeave"
          >
            Discard
          </button>
          <button
            type="button"
            class="cursor-default rounded-sm px-2 py-0.5 text-[11px] text-ink-3"
            @click="pendingLeave = null"
          >
            Keep editing
          </button>
        </div>
      </section>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="requestClose"
      >
        Done
      </button>
    </template>
  </Modal>
</template>
