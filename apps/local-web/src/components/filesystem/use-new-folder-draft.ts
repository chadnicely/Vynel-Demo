import { computed, nextTick, ref, type Ref } from "vue";
import { useCreateDirectory } from "../../composables/workspaces/use-create-directory.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { FileSystemSelection } from "./file-system-selection.js";

/** The browser's "New folder" draft — Explorer's flow: a name box appears
 *  (pre-filled + selected), Enter makes the folder inside the open one, and
 *  the created folder is handed back so the browser can highlight it. */
export function useNewFolderDraft(
  parentPath: Ref<string | null>,
  onCreated: (folder: FileSystemSelection) => void,
) {
  const createDirectory = useCreateDirectory();
  const isNaming = ref(false);
  const name = ref("");
  const inputElement = ref<HTMLInputElement | null>(null);
  const error = computed(() =>
    createDirectory.error.value ? formatSdkError(createDirectory.error.value) : null,
  );
  const isPending = computed(() => createDirectory.isPending.value);
  const canSubmit = computed(() => name.value.trim().length > 0 && !isPending.value);

  async function start() {
    if (parentPath.value === null) return;
    createDirectory.reset();
    name.value = "New folder";
    isNaming.value = true;
    await nextTick();
    inputElement.value?.select();
  }

  function cancel() {
    isNaming.value = false;
    name.value = "";
    createDirectory.reset();
  }

  function submit() {
    const parent = parentPath.value;
    if (parent === null || !canSubmit.value) return;
    createDirectory.mutate(
      { parentPath: parent, name: name.value.trim() },
      {
        onSuccess: (created) => {
          isNaming.value = false;
          name.value = "";
          onCreated({ kind: "folder", path: created.path, name: created.name });
        },
      },
    );
  }

  return { isNaming, name, inputElement, error, isPending, canSubmit, start, cancel, submit };
}
