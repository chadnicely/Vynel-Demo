<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import {
  SHIKI_THEMES,
  isHighlightableLanguage,
  loadHighlighter,
} from "../lib/shiki-highlighter.js";

// `| undefined` on the optionals: consumers forward values that are themselves
// optional (exactOptionalPropertyTypes).
const props = defineProps<{
  code: string;
  language?: string | undefined;
  /** First line's number (Read with an offset starts mid-file). */
  startLine?: number | undefined;
  lineNumbers?: boolean | undefined;
}>();

const highlightedHtml = ref<string | null>(null);

const canHighlight = computed(
  () => props.language !== undefined && isHighlightableLanguage(props.language),
);

const fallbackLines = computed(() => props.code.split("\n"));

watchEffect(async () => {
  if (!canHighlight.value || props.code.length === 0) {
    highlightedHtml.value = null;
    return;
  }
  const code = props.code;
  const language = props.language!;
  const highlighter = await loadHighlighter();
  highlightedHtml.value = highlighter.codeToHtml(code, {
    lang: language,
    themes: SHIKI_THEMES,
    defaultColor: false,
  });
});
</script>

<template>
  <div
    class="code-block"
    :class="{ 'has-line-numbers': props.lineNumbers }"
    :style="{ '--start-line': props.startLine ?? 1 }"
  >
    <!-- Shiki output is generated from plain code text by a trusted local
         highlighter — no user-controlled HTML passes through unescaped. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="highlightedHtml" class="highlighted" v-html="highlightedHtml" />
    <pre v-else class="plain"><code><span
      v-for="(line, index) in fallbackLines"
      :key="index"
      class="line"
    >{{ line }}
</span></code></pre>
  </div>
</template>

<style scoped>
.code-block {
  background: var(--bg-shell);
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  overflow: auto;
  max-height: 320px;
  font: 400 12px/1.7 var(--font-mono);
}

.code-block :deep(pre) {
  margin: 0;
  padding: 10px 12px;
  background: transparent !important;
  font: inherit;
}

.code-block :deep(code) {
  display: block;
  counter-reset: line calc(var(--start-line, 1) - 1);
}

.code-block :deep(.line) {
  white-space: pre;
}

.has-line-numbers :deep(.line)::before {
  counter-increment: line;
  content: counter(line);
  display: inline-block;
  width: 2.2em;
  margin-right: 14px;
  text-align: right;
  color: var(--ink-3);
  user-select: none;
}

/* Shiki dual themes: every token carries both palettes as CSS vars. */
.code-block :deep(.shiki span) {
  color: var(--shiki-light);
}

[data-theme="dark"] .code-block :deep(.shiki span) {
  color: var(--shiki-dark);
}

.plain {
  color: var(--ink-2);
}
</style>
