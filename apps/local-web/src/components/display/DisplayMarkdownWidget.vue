<script setup lang="ts">
import { MarkdownText } from "@vynel/ui";
import type { MarkdownWidgetContent } from "@vynel/contracts/display/display-widget-content";

// Claude's prose on the board. The body is MODEL OUTPUT, so it reaches the DOM
// through `MarkdownText` and nothing else — markdown-it, then DOMPurify, then
// shiki. There is no v-html here and there must never be one.
const props = defineProps<{ content: MarkdownWidgetContent }>();
</script>

<template>
  <div class="display-markdown" data-testid="display-widget-markdown">
    <MarkdownText variant="reply" :source="props.content.body" />
  </div>
</template>

<style scoped>
/* MarkdownText paints itself from the APP's ink tokens, which follow the app
   theme — on this deliberately dark ground the light-theme inks would be near
   invisible. So the room re-inks it from its own palette; the metrics (size,
   spacing, code chrome) stay MarkdownText's. */
.display-markdown :deep(.markdown-text) {
  color: var(--display-text, #cdf3ff);
  letter-spacing: normal;
}

.display-markdown :deep(h1),
.display-markdown :deep(h2),
.display-markdown :deep(h3),
.display-markdown :deep(h4),
.display-markdown :deep(strong) {
  color: var(--display-text, #cdf3ff);
}

.display-markdown :deep(a) {
  color: var(--display-accent, #4fd8ff);
}

.display-markdown :deep(code) {
  background: rgba(79, 216, 255, 0.12);
  color: var(--display-accent, #4fd8ff);
}

.display-markdown :deep(li)::marker {
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}
</style>
