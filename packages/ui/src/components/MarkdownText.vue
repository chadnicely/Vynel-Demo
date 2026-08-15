<script lang="ts">
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import {
  SHIKI_THEMES,
  getLoadedHighlighter,
  isHighlightableLanguage,
} from "../lib/shiki-highlighter.js";

// One renderer for every markdown surface (assistant messages, file preview).
// Module-scoped: configured once, shared by all instances. Fenced code blocks
// highlight through the shared shiki instance once it has loaded (markdown-it
// treats a returned "<pre…" as final output).
const markdown = new MarkdownIt({
  linkify: true,
  breaks: true,
  highlight: (code, language) => {
    const highlighter = getLoadedHighlighter();
    if (!highlighter || !isHighlightableLanguage(language)) return "";
    return highlighter.codeToHtml(code, {
      lang: language,
      themes: SHIKI_THEMES,
      defaultColor: false,
    });
  },
});

// GitHub-style task lists: markdown-it leaves "[x] " as literal text — swap
// the markers for styled checkboxes. Runs on our own generated HTML, before
// sanitizing.
function renderTaskCheckboxes(html: string): string {
  return html
    .replace(
      /<li>(<p>)?\[[xX]\] /g,
      (_match, paragraph: string | undefined) =>
        `<li class="task-item">${paragraph ?? ""}<span class="task-checkbox is-done" aria-hidden="true"></span>`,
    )
    .replace(
      /<li>(<p>)?\[ \] /g,
      (_match, paragraph: string | undefined) =>
        `<li class="task-item">${paragraph ?? ""}<span class="task-checkbox" aria-hidden="true"></span>`,
    );
}
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import { loadHighlighter } from "../lib/shiki-highlighter.js";

// `reply` is the canvas's chat-answer typography (its `blocks` renderer):
// tighter type, blocks 7px apart, accent-tinted inline code. It lives HERE so
// the streaming answer and the settled one cannot drift — the thread must not
// reformat when a turn completes.
const props = withDefaults(
  defineProps<{ source: string; variant?: "default" | "reply" }>(),
  { variant: "default" },
);

// Re-render once the highlighter arrives so code fences pick up colors.
const isHighlighterReady = ref(getLoadedHighlighter() !== null);
if (!isHighlighterReady.value) {
  void loadHighlighter().then(() => {
    isHighlighterReady.value = true;
  });
}

// Built here rather than bound inline so the element stays one line — the
// `vue/no-v-html` disable comment has to sit directly above the v-html.
const rootClass = computed(() =>
  props.variant === "reply" ? "markdown-text is-reply" : "markdown-text",
);

const rendered = computed(() => {
  void isHighlighterReady.value;
  return DOMPurify.sanitize(
    renderTaskCheckboxes(markdown.render(props.source)),
    // DOMPurify 3.4's default URI allowlist plus the app's own `vynel:`
    // scheme — in-app deep links (e.g. `vynel://plan/<id>`) the shell's link
    // router intercepts. Everything else (javascript:, data:, …) still
    // strips. Re-derive from the library default on a DOMPurify bump.
    {
      ALLOWED_URI_REGEXP:
        /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|vynel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    },
  );
});
</script>

<template>
  <!-- DOMPurify-sanitized above, so v-html is safe here -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div :class="rootClass" v-html="rendered" />
</template>

<style scoped>
.markdown-text {
  color: var(--ink-1);
  font: 400 13.5px/1.65 var(--font-ui);
  overflow-wrap: break-word;
}

/* THE REPLY VOICE — the canvas's chat answer, one home for the streaming and
   the settled render. The caller still owns the ink (a lead reads brighter
   than the detail under it); this owns metrics and inline treatments. */
/* `--reply-leading` is the caller's one dial: a reply's LEAD sets it tighter
   than the detail beneath it. Exposed as a property rather than left to be
   overridden, because a caller re-declaring `font` ties at this rule's
   specificity and the winner falls out of stylesheet order. */
.markdown-text.is-reply {
  font: 400 12.5px/var(--reply-leading, 1.5) var(--font-ui);
}

.markdown-text.is-reply :deep(p),
.markdown-text.is-reply :deep(ul),
.markdown-text.is-reply :deep(ol) {
  margin: 0 0 7px;
}

.markdown-text.is-reply :deep(p:last-child),
.markdown-text.is-reply :deep(ul:last-child),
.markdown-text.is-reply :deep(ol:last-child) {
  margin-bottom: 0;
}

/* The canvas's 10px list indent plus the 8px it gaps marker to text. */
.markdown-text.is-reply :deep(ul),
.markdown-text.is-reply :deep(ol) {
  padding-left: 18px;
}

.markdown-text.is-reply :deep(li) {
  margin: 0;
}

.markdown-text.is-reply :deep(li)::marker {
  color: var(--color-neutral-600);
}

.markdown-text.is-reply :deep(strong) {
  color: var(--color-neutral-100);
  font-weight: 600;
}

.markdown-text.is-reply :deep(code) {
  padding: 1px 5px;
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  color: var(--color-accent-200);
  font-size: 11.5px;
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

.markdown-text :deep(li.task-item) {
  list-style: none;
  margin-left: -18px;
}

.markdown-text :deep(.task-checkbox) {
  display: inline-block;
  width: 13px;
  height: 13px;
  margin-right: 7px;
  vertical-align: -2px;
  border: 1px solid var(--hair-strong);
  border-radius: 3px;
  background: var(--bg-panel);
}

.markdown-text :deep(.task-checkbox.is-done) {
  background: var(--gold);
  border-color: var(--gold);
  position: relative;
}

.markdown-text :deep(.task-checkbox.is-done)::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 3px;
  height: 7px;
  border: solid var(--color-bg);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.markdown-text :deep(code) {
  font: 400 12px/1.5 var(--font-mono);
  color: var(--file-code);
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
  color: inherit;
  padding: 0;
  font-size: 12px;
}

/* Shiki dual themes inside fences */
.markdown-text :deep(pre.shiki) {
  background: var(--bg-shell) !important;
}

.markdown-text :deep(.shiki span) {
  color: var(--shiki-light);
}

[data-theme="dark"] .markdown-text :deep(.shiki span) {
  color: var(--shiki-dark);
}

.markdown-text :deep(h1),
.markdown-text :deep(h2),
.markdown-text :deep(h3) {
  margin: 14px 0 8px;
  color: var(--file-doc);
  font-weight: 600;
  line-height: 1.4;
}

.markdown-text :deep(h1:first-child),
.markdown-text :deep(h2:first-child),
.markdown-text :deep(h3:first-child) {
  margin-top: 0;
}

.markdown-text :deep(h1) {
  font-size: 18px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--hair);
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
  border-left: 2px solid var(--info);
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
  /* A wide table scrolls inside its own box — the thread column clips
     horizontal overflow, so without this a narrow panel would cut off the
     right columns with no way to reach them. */
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.markdown-text :deep(th) {
  background: var(--bg-panel);
  color: var(--ink-2);
}

.markdown-text :deep(th),
.markdown-text :deep(td) {
  border: 1px solid var(--hair);
  padding: 4px 10px;
  text-align: left;
}
</style>
