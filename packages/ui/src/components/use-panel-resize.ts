import { onScopeDispose, ref } from "vue";

// ONE home for panel-resize mechanics (ResizablePanel + the conversation
// sidebar): pointer-capture drag, keyboard steps, min/max clamp, width
// persisted to localStorage. Capture keeps the gesture on the handle with no
// window listeners to leak; body text-selection is suspended for the drag —
// the browser otherwise starts selecting across the page under the moving
// cursor — and restored even if the owning component unmounts mid-drag.

export interface PanelResizeOptions {
  /** Which screen edge the panel hugs — flips the drag/keyboard direction
   *  (a left panel grows as the divider moves right, a right panel shrinks). */
  side: "left" | "right";
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export function usePanelResize(options: PanelResizeOptions) {
  function clamp(value: number): number {
    return Math.min(options.maxWidth, Math.max(options.minWidth, value));
  }

  // An out-of-range stored width clamps rather than resets — a layout saved
  // under older bounds degrades to the nearest legal width.
  function readStoredWidth(): number {
    const raw = localStorage.getItem(options.storageKey);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clamp(parsed) : options.defaultWidth;
  }

  const width = ref(readStoredWidth());
  const dragging = ref(false);

  function persist() {
    localStorage.setItem(options.storageKey, String(Math.round(width.value)));
  }

  function toDelta(pointerDelta: number): number {
    return options.side === "left" ? pointerDelta : -pointerDelta;
  }

  let settleActiveDrag: (() => void) | null = null;

  function startResize(event: PointerEvent) {
    // One gesture at a time — a second pointer (touch during a mouse drag)
    // would nest userSelect snapshots and could restore to "none".
    if (settleActiveDrag !== null) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    // Optional-chained: happy-dom's elements don't implement pointer capture.
    handle.setPointerCapture?.(event.pointerId);
    const restoreUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const startX = event.clientX;
    const startWidth = width.value;
    dragging.value = true;
    const onMove = (move: PointerEvent) => {
      width.value = clamp(startWidth + toDelta(move.clientX - startX));
    };
    const settle = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", settle);
      handle.removeEventListener("pointercancel", settle);
      document.body.style.userSelect = restoreUserSelect;
      dragging.value = false;
      persist();
      settleActiveDrag = null;
    };
    settleActiveDrag = settle;
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", settle);
    handle.addEventListener("pointercancel", settle);
  }

  function onKeydown(event: KeyboardEvent) {
    const step = (event.shiftKey ? 32 : 8) * (options.side === "left" ? 1 : -1);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      width.value = clamp(width.value + step);
      persist();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      width.value = clamp(width.value - step);
      persist();
    }
  }

  function reset() {
    width.value = options.defaultWidth;
    persist();
  }

  onScopeDispose(() => settleActiveDrag?.());

  return { width, dragging, startResize, onKeydown, reset };
}
