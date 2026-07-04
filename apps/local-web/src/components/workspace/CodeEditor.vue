<script lang="ts">
// CodeMirror 6, loaded lazily so the editor chunk stays out of the shell
// bundle. One module-level load shared by every editor instance.
async function loadCodeMirror() {
  const [
    core,
    view,
    language,
    lezer,
    langMd,
    langJs,
    langJson,
    langHtml,
    langCss,
  ] = await Promise.all([
    import("codemirror"),
    import("@codemirror/view"),
    import("@codemirror/language"),
    import("@lezer/highlight"),
    import("@codemirror/lang-markdown"),
    import("@codemirror/lang-javascript"),
    import("@codemirror/lang-json"),
    import("@codemirror/lang-html"),
    import("@codemirror/lang-css"),
  ]);
  return {
    core,
    view,
    language,
    lezer,
    langMd,
    langJs,
    langJson,
    langHtml,
    langCss,
  };
}

type CodeMirrorModules = Awaited<ReturnType<typeof loadCodeMirror>>;

let modulesPromise: Promise<CodeMirrorModules> | null = null;

function getCodeMirror(): Promise<CodeMirrorModules> {
  if (!modulesPromise) modulesPromise = loadCodeMirror();
  return modulesPromise;
}

/** Extension (file suffix) → CodeMirror language support. */
function languageSupportFor(extension: string, m: CodeMirrorModules) {
  switch (extension) {
    case "md":
    case "markdown":
      return [m.langMd.markdown()];
    case "js":
    case "jsx":
      return [m.langJs.javascript({ jsx: true })];
    case "ts":
    case "tsx":
      return [m.langJs.javascript({ typescript: true, jsx: true })];
    case "json":
      return [m.langJson.json()];
    case "html":
    case "svg":
    case "vue":
      return [m.langHtml.html()];
    case "css":
      return [m.langCss.css()];
    default:
      return [];
  }
}

function buildTheme(m: CodeMirrorModules) {
  // Chrome colors ride the design tokens so both themes just work.
  const chrome = m.view.EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--bg-panel)",
      color: "var(--ink-1)",
      fontSize: "12.5px",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.7",
      caretColor: "var(--gold)",
    },
    ".cm-cursor": { borderLeftColor: "var(--gold)" },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": {
      backgroundColor: "var(--bg-panel)",
      color: "var(--ink-3)",
      border: "none",
      paddingRight: "6px",
    },
    ".cm-activeLine": { backgroundColor: "var(--row-hover)" },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--ink-1)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--gold-soft)",
    },
  });

  const highlight = m.language.HighlightStyle.define([
    { tag: m.lezer.tags.heading, color: "var(--file-doc)", fontWeight: "600" },
    { tag: m.lezer.tags.strong, fontWeight: "600" },
    { tag: m.lezer.tags.emphasis, fontStyle: "italic" },
    {
      tag: m.lezer.tags.link,
      color: "var(--info)",
      textDecoration: "underline",
    },
    { tag: m.lezer.tags.url, color: "var(--info)" },
    { tag: m.lezer.tags.monospace, color: "var(--file-code)" },
    { tag: m.lezer.tags.quote, color: "var(--ink-2)", fontStyle: "italic" },
    { tag: m.lezer.tags.keyword, color: "var(--file-image)" },
    {
      tag: [m.lezer.tags.string, m.lezer.tags.special(m.lezer.tags.string)],
      color: "var(--ok)",
    },
    { tag: m.lezer.tags.comment, color: "var(--ink-3)", fontStyle: "italic" },
    { tag: m.lezer.tags.number, color: "var(--file-code)" },
    { tag: m.lezer.tags.bool, color: "var(--file-code)" },
    { tag: m.lezer.tags.propertyName, color: "var(--info)" },
    { tag: m.lezer.tags.attributeName, color: "var(--file-image)" },
    { tag: m.lezer.tags.tagName, color: "var(--file-code)" },
    { tag: m.lezer.tags.processingInstruction, color: "var(--ink-3)" },
  ]);

  return [chrome, m.language.syntaxHighlighting(highlight)];
}
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { EditorView } from "@codemirror/view";

// A colorful editable buffer (VS Code-like). Mount-per-file: the parent keys
// this component by file path, so language/doc setup happens exactly once.
const props = defineProps<{
  modelValue: string;
  /** File suffix, e.g. "md", "ts", "csv". Unknown suffixes edit as plain text. */
  language: string;
  placeholder?: string | undefined;
}>();

const emit = defineEmits<{
  "update:modelValue": [content: string];
}>();

const host = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

onMounted(async () => {
  const m = await getCodeMirror();
  if (!host.value) return;

  editorView = new m.view.EditorView({
    doc: props.modelValue,
    parent: host.value,
    extensions: [
      m.core.minimalSetup,
      m.view.lineNumbers(),
      m.view.highlightActiveLine(),
      m.view.EditorView.lineWrapping,
      m.view.placeholder(props.placeholder ?? ""),
      ...languageSupportFor(props.language, m),
      ...buildTheme(m),
      m.view.EditorView.updateListener.of((update) => {
        if (update.docChanged)
          emit("update:modelValue", update.state.doc.toString());
      }),
    ],
  });
});

// External resets (Discard) write back into the buffer.
watch(
  () => props.modelValue,
  (value) => {
    if (!editorView) return;
    const current = editorView.state.doc.toString();
    if (current === value) return;
    editorView.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  },
);

onUnmounted(() => {
  editorView?.destroy();
  editorView = null;
});
</script>

<template>
  <div ref="host" class="code-editor" />
</template>

<style scoped>
.code-editor {
  height: 100%;
  min-height: 360px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  overflow: hidden;
  background: var(--bg-panel);
}

.code-editor :deep(.cm-editor) {
  height: 100%;
}

.code-editor :deep(.cm-scroller) {
  overflow: auto;
}
</style>
