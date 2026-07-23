import { ref } from "vue";
import type { Ref } from "vue";

// How many Modals are open right now, app-wide. Shells that layer NATIVE
// surfaces above the DOM (the desktop browser webview draws over ALL HTML)
// watch this to yield while any dialog is up — one report from the shared
// primitive instead of enumerating every dialog that might ever open.
const openModalCount: Ref<number> = ref(0);

export function useOpenModalCount(): Readonly<Ref<number>> {
  return openModalCount;
}

/** Modal.vue only: report one modal's open-state transitions. */
export function reportModalOpenChange(open: boolean): void {
  openModalCount.value = Math.max(0, openModalCount.value + (open ? 1 : -1));
}
