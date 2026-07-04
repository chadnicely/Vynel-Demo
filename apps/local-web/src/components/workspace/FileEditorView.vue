<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  File,
  FileCode2,
  FileJson,
  FileText,
  Image,
  Pencil,
  X,
} from "lucide-vue-next";
import {
  CodeBlock,
  EmptyState,
  IconButton,
  languageForFilePath,
} from "@vynel/ui";
import {
  getDemoFileContent,
  saveDemoFileContent,
} from "../../demo/demo-file-store.js";
import { fileColorFamily } from "./file-colors.js";

// The canvas file editor — view (highlighted, line numbers) + a plain edit
// mode with save. Demo-phase: reads/writes the in-memory demo file store;
// the files API's read/write routes swap in behind the same two calls.
// (CodeMirror is the deliberate upgrade path once real file I/O lands.)
const props = defineProps<{
  workspaceId: string;
  filePath: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const isEditing = ref(false);
const draft = ref("");
const justSaved = ref(false);

const fileName = computed(
  () => props.filePath.split("/").pop() ?? props.filePath,
);
const colorFamily = computed(() => fileColorFamily(fileName.value));
const language = computed(() => languageForFilePath(fileName.value));
const content = ref(getDemoFileContent(props.workspaceId, props.filePath));

// Opening another file swaps the whole view state.
watch(
  () => [props.workspaceId, props.filePath] as const,
  () => {
    content.value = getDemoFileContent(props.workspaceId, props.filePath);
    isEditing.value = false;
    justSaved.value = false;
  },
);

const FILE_ICONS = {
  folder: File,
  doc: FileText,
  data: FileJson,
  image: Image,
  code: FileCode2,
  plain: File,
} as const;

function startEditing() {
  draft.value = content.value;
  isEditing.value = true;
  justSaved.value = false;
}

function save() {
  saveDemoFileContent(props.workspaceId, props.filePath, draft.value);
  content.value = draft.value;
  isEditing.value = false;
  justSaved.value = true;
}

function cancel() {
  isEditing.value = false;
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
        <p class="file-name">{{ fileName }}</p>
        <p class="file-path">{{ props.filePath }}</p>
      </div>

      <span v-if="justSaved" class="saved-note">Saved</span>

      <template v-if="isEditing">
        <button type="button" class="action is-primary" @click="save()">
          Save
        </button>
        <button type="button" class="action" @click="cancel()">Cancel</button>
      </template>
      <template v-else>
        <IconButton label="Edit file" @click="startEditing()">
          <Pencil :size="14" />
        </IconButton>
        <IconButton label="Close file" @click="emit('close')">
          <X :size="15" />
        </IconButton>
      </template>
    </header>

    <div class="editor-body">
      <textarea
        v-if="isEditing"
        v-model="draft"
        class="edit-area"
        spellcheck="false"
      />
      <EmptyState
        v-else-if="content.length === 0"
        title="Nothing here yet"
        hint="This file is empty — hit the pencil to start writing."
      />
      <CodeBlock
        v-else
        class="view-block"
        :code="content"
        :language="language"
        line-numbers
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
  color: var(--ink-1);
  font: 600 13px/1.4 var(--font-ui);
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
  color: #14171c;
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

.view-block {
  max-height: none;
}

.edit-area {
  width: 100%;
  height: 100%;
  min-height: 320px;
  resize: none;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12.5px/1.7 var(--font-mono);
  padding: 12px 14px;
  outline: none;
}

.edit-area:focus {
  border-color: var(--ink-3);
}
</style>
