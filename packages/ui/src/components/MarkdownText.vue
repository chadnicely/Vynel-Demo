<script lang="ts">
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

// One renderer for every markdown surface (assistant messages, notes).
// Module-scoped: configured once, shared by all instances.
const markdown = new MarkdownIt({ linkify: true, breaks: true });
</script>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ source: string }>();

const rendered = computed(() =>
  DOMPurify.sanitize(markdown.render(props.source)),
);
</script>

<template>
  <!-- DOMPurify-sanitized above, so v-html is safe here -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="markdown-text" v-html="rendered" />
</template>

<style scoped>
.markdown-text {
  color: var(--ink-1);
  font: 400 13.5px/1.65 var(--font-ui);
  overflow-wrap: break-word;
}

.markdown-text :deep(p) {
  margin: 0 0 10px;
}

.markdown-text :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-text :deep(a) {
  color: var(--info);
  text-decoration: none;
}

.markdown-text :deep(a:hover) {
  text-decoration: underline;
}

.markdown-text :deep(ul),
.markdown-text :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}

.markdown-text :deep(li) {
  margin: 2px 0;
}

.markdown-text :deep(code) {
  font: 400 12px/1.5 var(--font-mono);
  background: var(--row-active);
  border-radius: 4px;
  padding: 1px 5px;
}

.markdown-text :deep(pre) {
  margin: 0 0 10px;
  padding: 10px 12px;
  background: var(--bg-shell);
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  overflow-x: auto;
}

.markdown-text :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 12px;
}

.markdown-text :deep(h1),
.markdown-text :deep(h2),
.markdown-text :deep(h3) {
  margin: 14px 0 8px;
  font-weight: 600;
  line-height: 1.4;
}

.markdown-text :deep(h1) {
  font-size: 17px;
}

.markdown-text :deep(h2) {
  font-size: 15px;
}

.markdown-text :deep(h3) {
  font-size: 13.5px;
}

.markdown-text :deep(blockquote) {
  margin: 0 0 10px;
  padding: 4px 12px;
  border-left: 2px solid var(--hair-strong);
  color: var(--ink-2);
}

.markdown-text :deep(hr) {
  border: 0;
  border-top: 1px solid var(--hair);
  margin: 12px 0;
}

.markdown-text :deep(table) {
  border-collapse: collapse;
  margin: 0 0 10px;
  font-size: 12.5px;
}

.markdown-text :deep(th),
.markdown-text :deep(td) {
  border: 1px solid var(--hair);
  padding: 4px 10px;
  text-align: left;
}
</style>
