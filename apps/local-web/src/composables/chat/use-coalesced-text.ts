// `useCoalescedText` — the LiveSessionCard narration pattern, extracted
// (persona-sessions B5): steps can settle in sub-second bursts, and a
// flickering line reads as nervous. The displayed value swaps at most
// ~1×/interval, always ending on the latest source value.

import { onScopeDispose, ref, watch, type Ref } from "vue";

export const NARRATION_COALESCE_MS = 800;

export function useCoalescedText(
  source: () => string | null,
  intervalMs: number = NARRATION_COALESCE_MS,
): Ref<string | null> {
  const displayed = ref<string | null>(source());
  let lastSwapAtMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(source, (next) => {
    if (timer !== null) clearTimeout(timer);
    const dueInMs = lastSwapAtMs + intervalMs - Date.now();
    if (dueInMs <= 0) {
      displayed.value = next;
      lastSwapAtMs = Date.now();
      return;
    }
    timer = setTimeout(() => {
      displayed.value = source();
      lastSwapAtMs = Date.now();
    }, dueInMs);
  });
  onScopeDispose(() => {
    if (timer !== null) clearTimeout(timer);
  });
  return displayed;
}
