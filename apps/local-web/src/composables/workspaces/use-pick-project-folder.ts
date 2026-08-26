import { ref } from "vue";
import { useVynel } from "../use-vynel.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { VynelClient } from "@vynel/sdk";

// The ONE Browse button behind "a project you already have" (Chad,
// 2026-08-24). Two steps, one click: open the operating system's own folder
// window, then look inside whatever came back. Cancelling is a normal answer —
// it leaves everything exactly as it was, with no error on screen.

export type FolderScan = Awaited<ReturnType<VynelClient["workspaces"]["scanFolder"]>>;

export function usePickProjectFolder() {
  const vynel = useVynel();

  const pickedPath = ref<string | null>(null);
  const scan = ref<FolderScan | null>(null);
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);

  function reset() {
    pickedPath.value = null;
    scan.value = null;
    errorMessage.value = null;
  }

  async function choose(): Promise<void> {
    errorMessage.value = null;
    isBusy.value = true;
    try {
      const { path } = await vynel.workspaces.pickFolder();
      // Cancelled: keep whatever was already chosen rather than wiping the
      // screen — the user backed out of the dialog, not out of the task.
      if (path === null) return;
      pickedPath.value = path;
      scan.value = await vynel.workspaces.scanFolder({ path });
    } catch (error) {
      errorMessage.value = formatSdkError(error);
    } finally {
      isBusy.value = false;
    }
  }

  return { pickedPath, scan, isBusy, errorMessage, choose, reset };
}
