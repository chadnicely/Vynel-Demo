<script lang="ts">
export interface ComposerOption {
  id: string;
  label: string;
  /** Right-aligned dim annotation on the menu row (a model's context window). */
  hint?: string;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ContextRing from "./ContextRing.vue";
import SelectChip from "./SelectChip.vue";
import InlineSuggestMenu from "./InlineSuggestMenu.vue";
import {
  useComposerSuggest,
  type ComposerSuggestItem,
  type ComposerSuggestSources,
} from "../lib/use-composer-suggest.js";

// THE chat input, used by every chat surface: multiline draft, model + mode
// chips, optional voice, file attachments (picker, paste, drag-drop),
// send/stop. Data-blind — option lists and selections come in as props; the
// host wires them to real state. The draft is an optional v-model so a host
// can write into it (dictation types here). Icons are inline SVGs so
// @vynel/ui stays icon-library-free.
const props = withDefaults(
  defineProps<{
  placeholder?: string | undefined;
  /** True while a turn is streaming — the send button becomes Stop. */
  streaming?: boolean | undefined;
  models: ComposerOption[];
  modelId: string;
  /** Older-generation models behind the picker's collapsed "More models". */
  moreModels?: ComposerOption[] | undefined;
  modes: ComposerOption[];
  modeId: string;
  /** Thinking-effort choices — the chip renders only when both are provided. */
  efforts?: ComposerOption[] | undefined;
  effortId?: string | undefined;
  /** Context-window occupancy 0..1 — the ring renders only when non-null. */
  contextFraction?: number | null | undefined;
  contextTooltip?: string | undefined;
  showVoice?: boolean | undefined;
  /** True while the host is dictating into the draft — the mic pulses. */
  voiceActive?: boolean | undefined;
  /** A quiet one-line message above the input (e.g. "mic access denied"). */
  notice?: string | undefined;
  /** False hides the attach affordance and rejects pasted/dropped files —
   *  for surfaces whose turn route takes text only. Defaults TRUE explicitly —
   *  Vue's boolean-absent casting would otherwise read "not passed" as false
   *  and strip attachments from every chat surface. */
  allowAttachments?: boolean | undefined;
  /** Mention-picker rosters (chat-mentions) — the host wires real data;
   *  absent lists keep that trigger's picker off. Items carry their exact
   *  insert token, so the composer stays grammar-blind. */
  mentionSuggestions?: ComposerSuggestItem[] | undefined;
  workspaceSuggestions?: ComposerSuggestItem[] | undefined;
  slashSuggestions?: ComposerSuggestItem[] | undefined;
  }>(),
  { allowAttachments: true },
);

const emit = defineEmits<{
  send: [text: string, attachments: File[]];
  interrupt: [];
  voice: [];
  "update:modelId": [id: string];
  "update:modeId": [id: string];
  "update:effortId": [id: string];
}>();

const draft = defineModel<string>("draft", { default: "" });
const attachments = ref<File[]>([]);
const textareaElement = ref<HTMLTextAreaElement | null>(null);
const fileInputElement = ref<HTMLInputElement | null>(null);
const isDropTarget = ref(false);

// The mention pickers (@ agents/personas, # workspaces, / skills+commands):
// typing the bare trigger pops the anchored menu at the caret; typing filters;
// Enter/Tab/click inserts the token (the machinery lives in the composable —
// this component only wires events and renders the menu).
const suggestSources = computed<ComposerSuggestSources>(() => ({
  ...(props.mentionSuggestions !== undefined ? { "@": props.mentionSuggestions } : {}),
  ...(props.workspaceSuggestions !== undefined ? { "#": props.workspaceSuggestions } : {}),
  ...(props.slashSuggestions !== undefined ? { "/": props.slashSuggestions } : {}),
}));
const suggest = useComposerSuggest({
  draft,
  textareaElement,
  sources: suggestSources,
});
// Clamp the menu's caret anchor so it never overflows the composer's width.
const suggestMenuStyle = computed(() => ({
  left: `${Math.max(0, Math.min(suggest.caretLeft.value, 480))}px`,
  bottom: "100%",
}));

// Attachments default ON — only an explicit false opts a surface out.
const attachmentsAllowed = computed(() => props.allowAttachments);

function autoGrow() {
  const element = textareaElement.value;
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
}

// Hosts write the draft programmatically (dictation) — grow for them too.
watch(draft, () => void nextTick(autoGrow));

function submit() {
  const text = draft.value.trim();
  if (text.length === 0 && attachments.value.length === 0) return;
  // Streaming no longer blocks a send — the host QUEUES it for when the
  // current reply finishes (the old composer silently refused mid-turn sends).
  emit("send", text, attachments.value);
  draft.value = "";
  attachments.value = [];
  suggest.close();
  if (textareaElement.value) textareaElement.value.style.height = "auto";
}

function onKeydown(event: KeyboardEvent) {
  // An IME composition commit (CJK input) owns its Enter — neither a pick nor
  // a send (the suggest handler guards itself the same way; keyCode 229 is
  // the legacy composition signal). Pre-existing bug class in the send path,
  // fixed alongside the picker.
  if (event.isComposing || event.keyCode === 229) return;
  // The open mention picker owns navigation keys (Enter picks, never sends).
  if (suggest.onKeydown(event)) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}

// The trigger context follows the LIVE caret — recompute after the DOM applied
// the keystroke (input), and on caret moves (click / keyup for arrows+Home/End).
function refreshSuggest() {
  void nextTick(() => suggest.refresh());
}

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  addFiles(Array.from(input.files ?? []));
  input.value = "";
}

function addFiles(files: File[]) {
  // Every intake path (picker, paste, drop) funnels here — one gate.
  if (!attachmentsAllowed.value || files.length === 0) return;
  attachments.value = [...attachments.value, ...files];
}

function removeAttachment(index: number) {
  attachments.value = attachments.value.filter((_, i) => i !== index);
}

// Pasting a screenshot or a copied file attaches it; plain text pastes as
// usual (only intercept when the clipboard actually carries files).
function onPaste(event: ClipboardEvent) {
  if (!attachmentsAllowed.value) return;
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length === 0) return;
  event.preventDefault();
  addFiles(files);
}

// Drag-drop onto the whole composer. dragenter/dragleave fire on every child
// boundary — a depth counter keeps the highlight steady until the real leave.
let dragDepth = 0;

function dragCarriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

function onDragEnter(event: DragEvent) {
  if (!attachmentsAllowed.value || !dragCarriesFiles(event)) return;
  dragDepth += 1;
  isDropTarget.value = true;
}

function onDragLeave(event: DragEvent) {
  if (!dragCarriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) isDropTarget.value = false;
}

function onDrop(event: DragEvent) {
  dragDepth = 0;
  isDropTarget.value = false;
  addFiles(Array.from(event.dataTransfer?.files ?? []));
}
</script>

<template>
  <div
    class="chat-composer"
    :class="{ 'is-drop-target': isDropTarget }"
    @dragenter="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <p v-if="props.notice" class="composer-notice">{{ props.notice }}</p>

    <div v-if="attachments.length > 0" class="attachment-strip">
      <span
        v-for="(file, index) in attachments"
        :key="`${file.name}-${index}`"
        class="attachment-chip"
      >
        {{ file.name }}
        <button
          type="button"
          class="attachment-remove"
          :aria-label="`Remove ${file.name}`"
          @click="removeAttachment(index)"
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </span>
    </div>

    <div class="input-anchor">
      <InlineSuggestMenu
        v-if="suggest.isOpen.value"
        :items="suggest.items.value"
        :active-index="suggest.activeIndex.value"
        :style="suggestMenuStyle"
        @select="suggest.select"
        @hover="(index) => (suggest.activeIndex.value = index)"
      />
      <textarea
        ref="textareaElement"
        v-model="draft"
        class="input"
        rows="1"
        :placeholder="props.placeholder ?? 'Ask for anything…'"
        @input="
          autoGrow();
          refreshSuggest();
        "
        @keydown="onKeydown"
        @keyup="refreshSuggest"
        @click="refreshSuggest"
        @paste="onPaste"
      />
    </div>

    <div class="toolbar">
      <button
        v-if="attachmentsAllowed"
        type="button"
        class="tool-button"
        aria-label="Attach files"
        @click="fileInputElement?.click()"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 3v10M3 8h10"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <SelectChip
        :options="props.models"
        :more-options="props.moreModels"
        more-label="More models"
        :model-value="props.modelId"
        label="Model"
        opens-up
        @update:model-value="(id) => emit('update:modelId', id)"
      />

      <span class="divider" aria-hidden="true" />

      <SelectChip
        :options="props.modes"
        :model-value="props.modeId"
        label="Mode"
        opens-up
        @update:model-value="(id) => emit('update:modeId', id)"
      />

      <template v-if="props.efforts && props.effortId !== undefined">
        <span class="divider" aria-hidden="true" />

        <SelectChip
          :options="props.efforts"
          :model-value="props.effortId"
          label="Thinking"
          opens-up
          @update:model-value="(id) => emit('update:effortId', id)"
        />
      </template>

      <button
        v-if="props.showVoice"
        type="button"
        class="tool-button"
        :class="{ 'is-voice-active': props.voiceActive }"
        :aria-label="props.voiceActive ? 'Stop dictating' : 'Dictate a message'"
        @click="emit('voice')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="6"
            y="1.5"
            width="4"
            height="8"
            rx="2"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <path
            d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <span class="spacer" />

      <ContextRing
        v-if="props.contextFraction != null"
        class="context-slot"
        :fraction="props.contextFraction"
        :tooltip="props.contextTooltip"
      />

      <button
        v-if="props.streaming"
        type="button"
        class="send-button is-stop"
        aria-label="Stop the current task"
        @click="emit('interrupt')"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
          <rect
            x="3"
            y="3"
            width="10"
            height="10"
            rx="1.5"
            fill="currentColor"
          />
        </svg>
      </button>
      <!-- The send button STAYS while streaming (beside Stop) — a mid-turn
           send queues for when the reply finishes. -->
      <button
        type="button"
        class="send-button"
        :disabled="draft.trim().length === 0 && attachments.length === 0"
        :aria-label="
          props.streaming
            ? 'Queue message — sends when the current reply finishes'
            : 'Send message'
        "
        @click="submit()"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 13V3M3.5 7.5L8 3l4.5 4.5"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>

    <input
      v-if="attachmentsAllowed"
      ref="fileInputElement"
      type="file"
      multiple
      class="file-input"
      aria-hidden="true"
      tabindex="-1"
      @change="onFilesPicked"
    />
  </div>
</template>

<style scoped>
.chat-composer {
  display: grid;
  gap: 4px;
  padding: 10px 10px 8px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  box-shadow: var(--shadow-raised);
}

.chat-composer:focus-within {
  border-color: var(--ink-3);
}

.chat-composer.is-drop-target {
  border-color: var(--gold);
}

.composer-notice {
  margin: 0;
  color: var(--danger);
  font: 500 11.5px/1.5 var(--font-ui);
}

.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 2px 9px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: var(--bg-panel);
  color: var(--ink-2);
  font: 500 11px/1.6 var(--font-ui);
}

.attachment-remove {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 2px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-3);
  cursor: default;
}

.attachment-remove:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

/* The mention menu anchors here — above the input, at the caret's x. */
.input-anchor {
  position: relative;
  display: grid;
}

.input {
  border: 0;
  background: transparent;
  resize: none;
  min-height: 22px;
  max-height: 168px;
  color: var(--ink-1);
  font: 400 13.5px/1.6 var(--font-ui);
  outline: none;
}

.input::placeholder {
  color: var(--ink-3);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-button {
  appearance: none;
  border: 0;
  margin: 0;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  cursor: default;
}

.tool-button:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

/* Dictation live — gold is the "attention" accent; the pulse says recording. */
.tool-button.is-voice-active {
  color: var(--gold);
  background: var(--row-active);
  animation: dictation-pulse 1.6s ease-in-out infinite;
}

@keyframes dictation-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-button.is-voice-active {
    animation: none;
  }
}

.tool-button:focus-visible,
.send-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.divider {
  width: 1px;
  height: 14px;
  background: var(--hair-strong);
  margin: 0 2px;
}

.spacer {
  flex: 1;
}

.context-slot {
  margin-right: 4px;
}

.send-button {
  appearance: none;
  border: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-s);
  background: var(--gold);
  color: #14171c;
  cursor: default;
  transition: background var(--t-fast) var(--ease-out);
}

.send-button:hover:not(:disabled) {
  background: var(--gold-bright);
}

.send-button:disabled {
  background: var(--row-active);
  color: var(--ink-3);
}

.send-button.is-stop {
  background: var(--danger);
  color: #ffffff;
}

.file-input {
  display: none;
}
</style>
