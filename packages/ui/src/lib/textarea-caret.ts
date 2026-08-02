// Caret pixel measurement for a textarea (chat-mentions) — the classic
// mirror-div technique: clone the textarea's typography onto a hidden div,
// fill it with the text up to the caret, and read where a marker span lands.
// Used to anchor the inline suggest menu at the caret horizontally. Returns
// zeros in non-layout environments (jsdom) — callers must treat the value as
// a best-effort offset, never a load-bearing one.

const MIRRORED_STYLE_PROPERTIES = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
  'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'whiteSpace',
  'overflowWrap', 'tabSize',
] as const

export interface TextareaCaretPosition {
  /** Caret x relative to the textarea's border box (scroll-adjusted). */
  left: number
  /** Caret top y relative to the textarea's border box (scroll-adjusted). */
  top: number
}

/** Measure the caret's position inside a textarea. Best-effort: layout-free
 *  environments yield zeros. */
export function measureTextareaCaret(
  textarea: HTMLTextAreaElement,
  caretIndex: number,
): TextareaCaretPosition {
  const document = textarea.ownerDocument
  const mirror = document.createElement('div')
  const computed = textarea.ownerDocument.defaultView?.getComputedStyle(textarea)
  if (computed === undefined || computed === null) return { left: 0, top: 0 }

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  for (const property of MIRRORED_STYLE_PROPERTIES) {
    mirror.style[property as 'width'] = computed[property as 'width']
  }

  mirror.textContent = textarea.value.slice(0, caretIndex)
  const marker = document.createElement('span')
  // A zero-width marker still lays out at the caret's exact spot; the
  // remainder after it keeps wrapping identical to the real textarea.
  marker.textContent = '​'
  mirror.appendChild(marker)
  mirror.appendChild(document.createTextNode(textarea.value.slice(caretIndex)))

  document.body.appendChild(mirror)
  try {
    return {
      left: marker.offsetLeft - textarea.scrollLeft,
      top: marker.offsetTop - textarea.scrollTop,
    }
  } finally {
    mirror.remove()
  }
}
