<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { File, FileCode2, FileJson, FileText, Image, X } from "lucide-vue-next";
import { IconButton, MarkdownText, SegmentedTabs } from "@vynel/ui";
import {
  getDemoFileContent,
  saveDemoFileContent,
} from "../../demo/demo-file-store.js";
import { fileColorFamily } from "./file-colors.js";
import CodeEditor from "./CodeEditor.vue";

// The canvas file editor, VS Code semantics: a file opens straight into an
// editable buffer; markdown additionally gets a Code | Preview toggle.
// Demo-phase: reads/writes the in-memory demo file store; the files API's
// read/write routes swap in behind the same two calls. (CodeMirror is the
// deliberate upgrade path for highlighted editing once real file I/O lands.)
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

const savedContent = ref(getDemoFileContent(props.workspaceId, props.filePath));
const draft = ref(savedContent.value);
const mode = ref<"code" | "preview">("code");
const justSaved = ref(false);

const fileName = computed(
  () => props.filePath.split("/").pop() ?? props.filePath,
);
const colorFamily = computed(() => fileColorFamily(fileName.value));
const fileExtension = computed(
  () => fileName.value.split(".").pop()?.toLowerCase() ?? "",
);
const isPreviewable = computed(() => /\.(md|markdown)$/i.test(fileName.value));
const isDirty = computed(() => draft.value !== savedContent.value);

// Opening another file swaps the whole buffer.
watch(
  () => [props.workspaceId, props.filePath] as const,
  () => {
    savedContent.value = getDemoFileContent(props.workspaceId, props.filePath);
    draft.value = savedContent.value;
    mode.value = "code";
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

function save() {
  saveDemoFileContent(props.workspaceId, props.filePath, draft.value);
  savedContent.value = draft.value;
  justSaved.value = true;
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
          <span v-if="isDirty" class="dirty-dot" title="Unsaved changes" />
        </p>
        <p class="file-path">{{ props.filePath }}</p>
      </div>

      <span v-if="justSaved && !isDirty" class="saved-note">Saved</span>

      <SegmentedTabs
        v-if="isPreviewable"
        :tabs="EDITOR_MODES"
        :model-value="mode"
        @update:model-value="(id) => (mode = id as 'code' | 'preview')"
      />

      <template v-if="isDirty">
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
      <div v-if="isPreviewable && mode === 'preview'" class="preview">
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

.preview {
  max-width: 760px;
  margin: 0 auto;
  padding: 8px 4px;
}
</style>
