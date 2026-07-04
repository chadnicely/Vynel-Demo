import type { HighlighterGeneric } from "shiki";

// One shared shiki highlighter for every code surface (CodeBlock, markdown
// fences). Loaded lazily via dynamic import so the grammar payload
// code-splits out of the shell bundle; consumers render plain text until it
// resolves — content first, colors when ready.

export type AnyHighlighter = HighlighterGeneric<never, never>;

export const HIGHLIGHT_LANGUAGES = [
  "typescript",
  "javascript",
  "json",
  "markdown",
  "bash",
  "html",
  "css",
  "vue",
  "yaml",
];

/** Both palettes ship as CSS vars; `[data-theme]` picks the active one. */
export const SHIKI_THEMES = {
  dark: "github-dark-default",
  light: "github-light",
} as const;

export function isHighlightableLanguage(language: string): boolean {
  return HIGHLIGHT_LANGUAGES.includes(language);
}

let highlighterPromise: Promise<AnyHighlighter> | null = null;
let loadedHighlighter: AnyHighlighter | null = null;

export function loadHighlighter(): Promise<AnyHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(async (shiki) => {
      const highlighter = (await shiki.createHighlighter({
        themes: [SHIKI_THEMES.dark, SHIKI_THEMES.light],
        langs: HIGHLIGHT_LANGUAGES,
      })) as AnyHighlighter;
      loadedHighlighter = highlighter;
      return highlighter;
    });
  }
  return highlighterPromise;
}

/** Sync access for callers with synchronous render paths (markdown-it). */
export function getLoadedHighlighter(): AnyHighlighter | null {
  return loadedHighlighter;
}
