import { onBeforeUnmount, readonly, ref } from "vue";

/** How long something counts as alive after its last sign of work. Shared by
 *  both levels of the node screen so a project and its sessions can never
 *  disagree about what "still running" means. */
export const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

/** A minute tick. This is what lets a node actually drop out of the live
 *  states when its hour runs dry — a computed over `Date.now()` alone never
 *  re-fires on the clock, so the dot would stay lit until something else
 *  happened to invalidate it. */
export function useActiveNowTick() {
  const now = ref(Date.now());
  const timer = setInterval(() => {
    now.value = Date.now();
  }, 60_000);
  onBeforeUnmount(() => clearInterval(timer));
  return readonly(now);
}

/** Whether an ISO stamp falls inside the active window. Null (never) is not. */
export function isWithinActiveWindow(
  lastActivityAt: string | null,
  nowMs: number,
): boolean {
  if (lastActivityAt === null) return false;
  return nowMs - Date.parse(lastActivityAt) < ACTIVE_WINDOW_MS;
}
