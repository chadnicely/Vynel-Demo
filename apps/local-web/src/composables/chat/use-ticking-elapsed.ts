import { computed, onScopeDispose, ref, watch } from "vue";
import type { ComputedRef, MaybeRefOrGetter } from "vue";
import { toValue } from "vue";
import { formatElapsed } from "@vynel/ui";

// One home for the "working · 1m 32s" clock (the live turn's chip and the
// task card's working pill read the same tick): a 1s interval that exists
// only while the turn runs, formatted by the shared formatElapsed.
export function useTickingElapsed(
  startedAtMs: MaybeRefOrGetter<number | null>,
  isRunning: MaybeRefOrGetter<boolean>,
): ComputedRef<string | null> {
  const nowMs = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  watch(
    () => toValue(isRunning),
    (running) => {
      if (running && timer === null) {
        nowMs.value = Date.now();
        timer = setInterval(() => {
          nowMs.value = Date.now();
        }, 1000);
      } else if (!running && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    if (timer !== null) clearInterval(timer);
  });

  return computed(() => {
    const startMs = toValue(startedAtMs);
    return startMs === null ? null : formatElapsed(startMs, nowMs.value);
  });
}
