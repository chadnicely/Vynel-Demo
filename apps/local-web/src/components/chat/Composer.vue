<script setup lang="ts">
import { ref } from "vue";
import { ArrowUp, Square } from "lucide-vue-next";

const props = defineProps<{
  /** True while a turn is streaming — the button becomes Stop. */
  streaming?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  send: [text: string];
  interrupt: [];
}>();

const draft = ref("");

function submit() {
  const text = draft.value.trim();
  if (!text || props.streaming) return;
  emit("send", text);
  draft.value = "";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <div class="composer">
    <textarea
      v-model="draft"
      class="input"
      rows="1"
      :placeholder="props.placeholder ?? 'Ask for anything…'"
      @keydown="onKeydown"
    />
    <button
      v-if="props.streaming"
      type="button"
      class="send-button is-stop"
      aria-label="Stop the current task"
      @click="emit('interrupt')"
    >
      <Square :size="13" fill="currentColor" />
    </button>
    <button
      v-else
      type="button"
      class="send-button"
      :disabled="draft.trim().length === 0"
      aria-label="Send message"
      @click="submit()"
    >
      <ArrowUp :size="15" />
    </button>
  </div>
</template>

<style scoped>
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  box-shadow: var(--shadow-raised);
}

.composer:focus-within {
  border-color: var(--ink-3);
}

.input {
  flex: 1;
  border: 0;
  background: transparent;
  resize: none;
  min-height: 22px;
  max-height: 160px;
  color: var(--ink-1);
  font: 400 13.5px/1.6 var(--font-ui);
  outline: none;
}

.input::placeholder {
  color: var(--ink-3);
}

.send-button {
  appearance: none;
  border: 0;
  flex: none;
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

.send-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
