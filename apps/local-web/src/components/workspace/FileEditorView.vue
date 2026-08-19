<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhFile as File,
  PhFileCode as FileCode2,
  PhBracketsCurly as FileJson,
  PhFileText as FileText,
  PhImage as Image,
  PhX as X,
} from "@phosphor-icons/vue";
import { IconButton, MarkdownText, SegmentedTabs } from "@vynel/ui";
import { useFileContent } from "../../composables/files/use-file-content.js";
import { useSaveFile } from "../../composables/files/use-save-file.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { fileColorFamily } from "../../utils/file-colors.js";
import CodeEditor from "./CodeEditor.vue";

// The canvas file editor, VS Code semantics: a text file opens straight into an
// editable buffer; markdown additionally gets a Code | Preview toggle. Content
// is read from the files API asynchronously and saved back to real disk.
const props = defineProps<{
  workspaceId: string;
  filePath: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const EDITOR_MODES = [
  { id: "code", label: "Code" },
  { id: "preview", label: "Preview" },
];

const contentQuery = useFileContent(
  () => props.workspaceId,
  () => props.filePath,
);
const saveFile = useSaveFile(() => props.workspaceId);

const savedContent = ref("");
const draft = ref("");
const mode = ref<"code" | "preview">("code");
const justSaved = ref(false);

// Sync the buffer whenever the loaded content arrives or the open file changes.
// A background refetch (window focus, post-save invalidation) must not clobber
// unsaved edits — only reset the draft when the file changed or it isn't dirty.
watch(
  [() => props.filePath, () => contentQuery.data.value] as const,
  ([, data], previous) => {
    const filePathChanged =
      previous === undefined || previous[0] !== props.filePath;
    if (filePathChanged) {
      mode.value = "code";
      justSaved.value = false;
    }
    if (data) {
      const wasClean = draft.value === savedContent.value;
      savedContent.value = data.content ?? "";
      if (filePathChanged || wasClean) draft.value = savedContent.value;
    }
  },
  { immediate: true },
);

const fileName = computed(
  () => props.filePath.split("/").pop() ?? props.filePath,
);
const colorFamily = computed(() => fileColorFamily(fileName.value));
const fileExtension = computed(
  () => fileName.value.split(".").pop()?.toLowerCase() ?? "",
);

// Read the real content shape, not the filename: markdown gets the preview
// toggle; a text file that isn't truncated is editable; anything else is a
// read-only notice.
const fileKind = computed(() => contentQuery.data.value?.kind ?? null);
const isText = computed(() => contentQuery.data.value?.isText ?? false);
const isTruncated = computed(() => contentQuery.data.value?.isTruncated ?? false);
const isPreviewable = computed(() => fileKind.value === "markdown");
const isEditable = computed(() => isText.value && !isTruncated.value);
const isDirty = computed(() => draft.value !== savedContent.value);

const errorText = computed(() =>
  contentQuery.isError.value ? formatSdkError(contentQuery.error.value) : null,
);

// A failed disk write must never be silent — surface it so the user knows their
// edits are NOT saved (they persist in the buffer to retry).
const saveErrorText = computed(() =>
  saveFile.isError.value ? formatSdkError(saveFile.error.value) : null,
);

const FILE_ICONS = {
  folder: File,
  doc: FileText,
  data: FileJson,
  image: Image,
  code: FileCode2,
  plain: File,
} as const;

function save() {
  if (!isEditable.value) return;
  saveFile.mutate(
    { path: props.filePath, content: draft.value },
    {
      onSuccess: () => {
        savedContent.value = draft.value;
        justSaved.value = true;
      },
    },
  );
}

function discard() {
  draft.value = savedContent.value;
}
</script>

<template>
  <div class="file-editor">
    <header class="editor-header">
      <component
        :is="FILE_ICONS[colorFamily]"
        :size="15"
        class="file-icon"
        :class="`tone-${colorFamily}`"
      />
      <div class="titles">
        <p class="file-name">
          {{ fileName }}
          <span
            v-if="isDirty && isEditable"
            class="dirty-dot"
            title="Unsaved changes"
          />
        </p>
        <p class="file-path">{{ props.filePath }}</p>
      </div>

      <span v-if="justSaved && !isDirty" class="saved-note">Saved</span>
      <span
        v-if="saveErrorText"
        class="saved-note is-error"
        :title="saveErrorText"
        >Couldn't save</span
      >

      <SegmentedTabs
        v-if="isPreviewable && isEditable"
        :tabs="EDITOR_MODES"
        :model-value="mode"
        @update:model-value="(id) => (mode = id as 'code' | 'preview')"
      />

      <template v-if="isEditable && isDirty">
        <button type="button" class="action is-primary" @click="save()">
          Save
        </button>
        <button type="button" class="action" @click="discard()">Discard</button>
      </template>

      <IconButton label="Close file" @click="emit('close')">
        <X :size="15" />
      </IconButton>
    </header>

    <div class="editor-body">
      <p v-if="errorText" class="state-note is-error">{{ errorText }}</p>
      <p v-else-if="contentQuery.isPending.value" class="state-note">
        Loading…
      </p>

      <!-- Truncated: the buffer is only part of the file. Saving it would
           overwrite the file and lose the rest — read-only, no Save. -->
      <div v-else-if="isTruncated" class="notice">
        <p class="notice-title">This file is too large to edit safely</p>
        <p class="notice-hint">
          Only part of it loaded (truncated), so editing here could overwrite and
          lose the rest. Open it with a full editor to make changes.
        </p>
      </div>

      <!-- Binary / unsupported: nothing to edit as text. -->
      <div v-else-if="!isText" class="notice">
        <p class="notice-title">Can't edit this file here</p>
        <p class="notice-hint">
          {{ fileKind }} files open in a viewer, not the text editor.
        </p>
      </div>

      <div v-else-if="isPreviewable && mode === 'preview'" class="preview">
        <MarkdownText :source="draft" />
      </div>
      <CodeEditor
        v-else
        :key="props.filePath"
        v-model="draft"
        :language="fileExtension"
        placeholder="Start writing…"
      />
    </div>
  </div>
</template>

<style scoped>
.file-editor {
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  background: var(--bg-shell);
}

.editor-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--hair);
}

.file-icon {
  flex: none;
}

.tone-doc {
  color: var(--file-doc);
}

.tone-data {
  color: var(--file-data);
}

.tone-image {
  color: var(--file-image);
}

.tone-code {
  color: var(--file-code);
}

.tone-plain,
.tone-folder {
  color: var(--ink-3);
}

.titles {
  min-width: 0;
  flex: 1;
}

.file-name {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-1);
  font: 600 13px/1.4 var(--font-ui);
}

.dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-2);
}

.file-path {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.4 var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.saved-note {
  color: var(--ok);
  font: 600 11px/1.5 var(--font-ui);
}

.saved-note.is-error {
  color: var(--danger);
  cursor: help;
}

.action {
  appearance: none;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  padding: 3px 14px;
  font: 600 12px/1.6 var(--font-ui);
  background: transparent;
  color: var(--ink-2);
  cursor: default;
}

.action:hover {
  background: var(--row-hover);
  color: var(--ink-1);
}

.action.is-primary {
  background: var(--gold);
  border-color: transparent;
  color: var(--color-bg);
}

.action.is-primary:hover {
  background: var(--gold-bright);
}

.action:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.editor-body {
  min-height: 0;
  overflow-y: auto;
  padding: 14px 18px;
}

.state-note {
  margin: 0;
  color: var(--ink-3);
  font: 400 13px/1.6 var(--font-ui);
}

.state-note.is-error {
  color: var(--danger);
}

.notice {
  max-width: 520px;
  margin: 8px 0;
}

.notice-title {
  margin: 0 0 4px;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.notice-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 12.5px/1.6 var(--font-ui);
}

.preview {
  max-width: 760px;
  margin: 0 auto;
  padding: 8px 4px;
}
</style>
