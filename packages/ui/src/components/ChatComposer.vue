<script lang="ts">
export interface ComposerOption {
  id: string;
  label: string;
}
</script>

<script setup lang="ts">
import { ref } from "vue";
import SelectChip from "./SelectChip.vue";

// THE chat input, used by every chat surface: multiline draft, model + mode
// chips, optional voice, file attachments, send/stop. Data-blind — option
// lists and selections come in as props; the host wires them to real state.
// Icons are inline SVGs so @vynel/ui stays icon-library-free.
const props = defineProps<{
  placeholder?: string | undefined;
  /** True while a turn is streaming — the send button becomes Stop. */
  streaming?: boolean | undefined;
  models: ComposerOption[];
  modelId: string;
  modes: ComposerOption[];
  modeId: string;
  showVoice?: boolean | undefined;
}>();

const emit = defineEmits<{
  send: [text: string, attachments: File[]];
  interrupt: [];
  voice: [];
  "update:modelId": [id: string];
  "update:modeId": [id: string];
}>();

const draft = ref("");
const attachments = ref<File[]>([]);
const textareaElement = ref<HTMLTextAreaElement | null>(null);
const fileInputElement = ref<HTMLInputElement | null>(null);

function autoGrow() {
  const element = textareaElement.value;
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
}

function submit() {
  const text = draft.value.trim();
  if ((text.length === 0 && attachments.value.length === 0) || props.streaming)
    return;
  emit("send", text, attachments.value);
  draft.value = "";
  attachments.value = [];
  if (textareaElement.value) textareaElement.value.style.height = "auto";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  attachments.value = [...attachments.value, ...Array.from(input.files ?? [])];
  input.value = "";
}

function removeAttachment(index: number) {
  attachments.value = attachments.value.filter((_, i) => i !== index);
}
</script>

<template>
  <div class="chat-composer">
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

    <textarea
      ref="textareaElement"
      v-model="draft"
      class="input"
      rows="1"
      :placeholder="props.placeholder ?? 'Ask for anything…'"
      @input="autoGrow"
      @keydown="onKeydown"
    />

    <div class="toolbar">
      <button
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

      <button
        v-if="props.showVoice"
        type="button"
        class="tool-button"
        aria-label="Talk instead"
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
      <button
        v-else
        type="button"
        class="send-button"
        :disabled="draft.trim().length === 0 && attachments.length === 0"
        aria-label="Send message"
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
