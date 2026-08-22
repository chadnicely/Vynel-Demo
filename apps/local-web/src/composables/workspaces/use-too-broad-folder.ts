import { computed, ref, type Ref } from "vue";
import { isDriveRootPath } from "../../components/filesystem/file-system-path.js";
import type { FileSystemSelection } from "../../components/filesystem/file-system-selection.js";
import { useDirectoryListing } from "./use-directory-listing.js";

// A whole drive or the home folder isn't a room — it's the whole house. The
// one guard every folder-picking dialog runs (register a workspace, the
// wizard's home, the clone's home): what the user highlighted is too broad
// to be one workspace, and which word to say so with.
export function useTooBroadFolder(
  selection: Ref<FileSystemSelection | null>,
  enabled: Ref<boolean>,
) {
  // The same home read the browser opens with (shared query cache) — it
  // carries the known places, and Home is the one folder to refuse.
  const homeListing = useDirectoryListing(ref(null), enabled);
  const homePath = computed(
    () =>
      homeListing.data.value?.places.find((place) => place.kind === "home")
        ?.path ?? null,
  );
  const reason = computed<"drive" | "home folder" | null>(() => {
    if (selection.value === null) return null;
    if (isDriveRootPath(selection.value.path)) return "drive";
    if (selection.value.path === homePath.value) return "home folder";
    return null;
  });
  const isTooBroad = computed(() => reason.value !== null);
  return { homePath, isTooBroad, reason };
}
