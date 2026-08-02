// `useComposerSuggest` — the composer's mention-picker state machine
// (chat-mentions). ChatComposer stays data-blind: the HOST passes the three
// rosters (`@` agents+personas, `#` workspaces, `/` skills+commands) as
// suggestion items; this composable detects the open trigger at the caret,
// filters the roster by what's typed, drives keyboard navigation, and inserts
// the picked token back into the draft.
//
// Interaction contract (Chad, settled): the BARE trigger character pops the
// menu immediately; typing filters; ArrowUp/Down + Enter (or Tab) picks;
// Escape dismisses the current token's menu (it reopens on a fresh trigger).

import { computed, nextTick, ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import {
  applyComposerSuggestion,
  detectComposerTrigger,
  type ComposerTrigger,
  type ComposerTriggerContext,
} from './composer-trigger.js'
import { measureTextareaCaret } from './textarea-caret.js'

export interface ComposerSuggestItem {
  id: string
  /** The row's display text. */
  label: string
  /** Right-aligned dim annotation ("agent", "workspace", a description). */
  hint?: string
  /** Group heading this item renders under ("Agents", "Commands", …). */
  group?: string
  /** The EXACT text inserted at the trigger (e.g. `@code-reviewer`, `#"Q3 plans"`). */
  insert: string
}

/** The host's rosters, one list per trigger. Absent = that picker is off. */
export interface ComposerSuggestSources {
  '@'?: ComposerSuggestItem[]
  '#'?: ComposerSuggestItem[]
  '/'?: ComposerSuggestItem[]
}

const MAX_VISIBLE_ITEMS = 24

function filterItems(items: ComposerSuggestItem[], query: string): ComposerSuggestItem[] {
  if (query === '') return items.slice(0, MAX_VISIBLE_ITEMS)
  const term = query.toLowerCase()
  // Prefix matches on the inserted token first, then substring matches on the
  // label — stable within each tier (roster order is the host's ranking).
  const prefix: ComposerSuggestItem[] = []
  const substring: ComposerSuggestItem[] = []
  for (const item of items) {
    const insertBody = item.insert.replace(/^[@#/]/, '').replace(/^"/, '').toLowerCase()
    if (insertBody.startsWith(term)) prefix.push(item)
    else if (item.label.toLowerCase().includes(term) || insertBody.includes(term)) {
      substring.push(item)
    }
  }
  return [...prefix, ...substring].slice(0, MAX_VISIBLE_ITEMS)
}

export function useComposerSuggest(options: {
  draft: Ref<string>
  textareaElement: Ref<HTMLTextAreaElement | null>
  sources: MaybeRefOrGetter<ComposerSuggestSources>
}) {
  const context = ref<ComposerTriggerContext | null>(null)
  const activeIndex = ref(0)
  const caretLeft = ref(0)
  /** `${trigger}:${start}` dismissed via Escape — stays closed for that token. */
  const dismissedKey = ref<string | null>(null)

  const items = computed<ComposerSuggestItem[]>(() => {
    const current = context.value
    if (current === null) return []
    const roster = toValue(options.sources)[current.trigger] ?? []
    return filterItems(roster, current.query)
  })

  const isOpen = computed(() => context.value !== null && items.value.length > 0)

  /** Re-detect the trigger from the live caret — call on input/click/keyup. */
  function refresh(): void {
    const textarea = options.textareaElement.value
    if (textarea === null) {
      context.value = null
      return
    }
    const caretIndex = textarea.selectionStart ?? options.draft.value.length
    const detected = detectComposerTrigger(options.draft.value, caretIndex)
    const detectedKey = detected === null ? null : `${detected.trigger}:${detected.start}`
    if (detectedKey !== null && detectedKey === dismissedKey.value) {
      context.value = null
      return
    }
    if (detectedKey !== dismissedKey.value) dismissedKey.value = null
    const previous = context.value
    context.value = detected
    if (
      detected === null ||
      previous === null ||
      previous.trigger !== detected.trigger ||
      previous.start !== detected.start
    ) {
      activeIndex.value = 0
    } else {
      // Same token, narrower list — keep the highlight in range.
      activeIndex.value = Math.min(activeIndex.value, Math.max(items.value.length - 1, 0))
    }
    if (detected !== null) {
      caretLeft.value = measureTextareaCaret(textarea, detected.start).left
    }
  }

  function close(): void {
    context.value = null
  }

  function select(item: ComposerSuggestItem): void {
    const current = context.value
    const textarea = options.textareaElement.value
    if (current === null) return
    const caretIndex = textarea?.selectionStart ?? options.draft.value.length
    const applied = applyComposerSuggestion(options.draft.value, current, caretIndex, item.insert)
    options.draft.value = applied.text
    context.value = null
    void nextTick(() => {
      if (textarea === null) return
      textarea.focus()
      textarea.setSelectionRange(applied.caretIndex, applied.caretIndex)
    })
  }

  /** Intercept navigation keys while open. Returns true when handled — the
   *  composer must then skip its own Enter-to-send. */
  function onKeydown(event: KeyboardEvent): boolean {
    // A keydown that commits an IME composition (CJK input) is the IME's, not
    // ours — Enter there confirms the composed text, never a pick. keyCode
    // 229 is the legacy composition signal some engines still report.
    if (event.isComposing || event.keyCode === 229) return false
    if (!isOpen.value) return false
    const count = items.value.length
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeIndex.value = (activeIndex.value + 1) % count
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex.value = (activeIndex.value - 1 + count) % count
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const item = items.value[activeIndex.value]
      if (item !== undefined) select(item)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      const current = context.value
      if (current !== null) dismissedKey.value = `${current.trigger}:${current.start}`
      close()
      return true
    }
    return false
  }

  return {
    isOpen,
    items,
    activeIndex,
    caretLeft,
    trigger: computed<ComposerTrigger | null>(() => context.value?.trigger ?? null),
    refresh,
    close,
    select,
    onKeydown,
  }
}
