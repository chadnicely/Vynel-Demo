<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhFolder as Folder } from "@phosphor-icons/vue";
import type { DirectoryListingResponse } from "@vynel/contracts/workspaces/workspace-http";
import { useDirectoryListing } from "../../composables/workspaces/use-directory-listing.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import DriveTile from "./DriveTile.vue";
import FileSystemRail from "./FileSystemRail.vue";
import FileSystemTile from "./FileSystemTile.vue";
import FileSystemToolbar from "./FileSystemToolbar.vue";
import {
  basenameOfPath,
  driveDisplayName,
  splitPathIntoCrumbs,
  type PathCrumb,
} from "./file-system-path.js";
import {
  isSameSelection,
  type FileSystemSelection,
  type FileSystemSelectionMode,
} from "./file-system-selection.js";
import { useNewFolderDraft } from "./use-new-folder-draft.js";

// The one filesystem browser every picker dialog embeds — laid out like
// Windows Explorer so a non-technical user is on familiar ground: places +
// drives down the left, back/up/address crumbs on top, large-icon tiles in
// the pane, drive cards with capacity bars under "This PC". Click highlights,
// double-click (or Enter) opens. It reads through the local API's directory
// listing (a webview can't see absolute paths on its own).
const props = defineProps<{
  mode: FileSystemSelectionMode;
  /** True while the host dialog is open — a fresh open resets to Home. */
  active: boolean;
  modelValue: FileSystemSelection | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [selection: FileSystemSelection | null];
}>();

// null = the API's default start (the user's home directory).
const folderPath = ref<string | null>(null);
// "This PC" is a client-side view over the drives every listing carries — no
// folder is open while it shows, but the last listing stays for its rails.
const showingThisPc = ref(false);
const highlighted = ref<FileSystemSelection | null>(null);
type Location = { folderPath: string | null; showingThisPc: boolean };
const history = ref<Location[]>([]);

const isActive = computed(() => props.active);
const listingQuery = useDirectoryListing(folderPath, isActive, {
  includeFiles: props.mode !== "folder",
});
// The last listing that loaded. An unreadable folder (a system dir, a
// vanished USB stick) errors with no data — the rails and crumbs keep painting
// from here while the failed step is undone below and its reason shown.
const lastGoodListing = ref<DirectoryListingResponse>();
watch(
  () => listingQuery.data.value,
  (loaded) => {
    if (loaded) lastGoodListing.value = loaded;
  },
  { immediate: true },
);
const listing = computed(() => listingQuery.data.value ?? lastGoodListing.value);
const navigationError = ref<string | null>(null);
watch(
  () => listingQuery.error.value,
  (error) => {
    if (!error) return;
    navigationError.value = formatSdkError(error);
    goBack();
  },
);

const currentPath = computed(() =>
  showingThisPc.value ? null : (listing.value?.path ?? null),
);

// "New folder" lands highlighted, so it's already the pick.
const newFolder = useNewFolderDraft(currentPath, (created) => {
  highlighted.value = created;
});

watch(
  () => props.active,
  (active) => {
    if (!active) return;
    folderPath.value = null;
    showingThisPc.value = false;
    highlighted.value = null;
    history.value = [];
    navigationError.value = null;
    newFolder.cancel();
  },
  { immediate: true },
);

// The open folder stands in for a selection in the folder-capable modes —
// step into what you want, or highlight it.
const effectiveSelection = computed<FileSystemSelection | null>(() => {
  if (highlighted.value && (props.mode !== "file" || highlighted.value.kind === "file")) {
    return highlighted.value;
  }
  if (props.mode === "file" || currentPath.value === null) return null;
  return {
    kind: "folder",
    path: currentPath.value,
    name: basenameOfPath(currentPath.value),
  };
});
watch(
  effectiveSelection,
  (selection) => {
    if (!isSameSelection(selection, props.modelValue)) emit("update:modelValue", selection);
  },
  { immediate: true },
);

const crumbs = computed<PathCrumb[]>(() => {
  if (currentPath.value === null) return [];
  return splitPathIntoCrumbs(currentPath.value).map((crumb, index) => {
    if (index !== 0) return crumb;
    const drive = listing.value?.drives.find(
      (candidate) => candidate.path.toLowerCase() === crumb.path.toLowerCase(),
    );
    return drive ? { ...crumb, name: driveDisplayName(drive) } : crumb;
  });
});

function rememberLocation() {
  history.value.push({ folderPath: folderPath.value, showingThisPc: showingThisPc.value });
  highlighted.value = null;
  navigationError.value = null;
  newFolder.cancel();
}

function openFolder(path: string) {
  rememberLocation();
  folderPath.value = path;
  showingThisPc.value = false;
}

function openThisPc() {
  rememberLocation();
  showingThisPc.value = true;
}

function goBack() {
  const previous = history.value.pop();
  if (!previous) return;
  highlighted.value = null;
  folderPath.value = previous.folderPath;
  showingThisPc.value = previous.showingThisPc;
}

// Above a drive root sits "This PC" — the same one-more-up Explorer offers.
function goUp() {
  if (showingThisPc.value) return;
  if (listing.value?.parent) openFolder(listing.value.parent);
  else openThisPc();
}

function highlight(selection: FileSystemSelection) {
  highlighted.value = selection;
}

function clearHighlight() {
  highlighted.value = null;
}

const folderTiles = computed(() =>
  (listing.value?.entries ?? []).map((entry) => ({ kind: "folder" as const, ...entry })),
);
const fileTiles = computed(() =>
  (listing.value?.files ?? []).map((file) => ({ kind: "file" as const, ...file })),
);
const isEmptyFolder = computed(
  () => listing.value !== undefined && folderTiles.value.length === 0 && fileTiles.value.length === 0,
);
const emptyText = computed(() =>
  props.mode === "file"
    ? "Nothing here — go back and open a folder that has files."
    : "Nothing inside — this folder itself is what you'd pick.",
);
</script>

<template>
  <div class="fs-browser flex h-[340px] overflow-hidden rounded-md border border-hair bg-panel">
    <FileSystemRail
      :places="listing?.places ?? []"
      :drives="listing?.drives ?? []"
      :current-path="currentPath"
      @open-folder="openFolder"
      @open-this-pc="openThisPc"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <FileSystemToolbar
        :crumbs="crumbs"
        :can-go-back="history.length > 0"
        :can-go-up="!showingThisPc"
        :showing-this-pc="showingThisPc"
        :can-create-folder="currentPath !== null"
        @back="goBack"
        @up="goUp"
        @navigate="openFolder"
        @open-this-pc="openThisPc"
        @new-folder="newFolder.start"
      />

      <form
        v-if="newFolder.isNaming.value"
        class="fs-new-folder-row flex items-center gap-2 border-b border-hair bg-inset px-2 py-1.5"
        @submit.prevent="newFolder.submit"
      >
        <Folder :size="16" weight="fill" class="shrink-0 text-file-folder" />
        <input
          :ref="(el) => (newFolder.inputElement.value = el as HTMLInputElement | null)"
          v-model="newFolder.name.value"
          type="text"
          maxlength="255"
          aria-label="New folder name"
          class="min-w-0 flex-1 rounded-sm border border-hair-strong bg-panel px-2 py-[3px] text-[12px] text-ink-1 outline-none focus-visible:ring-1 focus-visible:ring-gold"
          @keydown.esc.prevent="newFolder.cancel"
        />
        <button
          type="submit"
          class="fs-new-folder-create cursor-default rounded-sm bg-gold px-2.5 py-[3px] text-[11.5px] font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
          :disabled="!newFolder.canSubmit.value"
        >
          {{ newFolder.isPending.value ? "Creating…" : "Create" }}
        </button>
        <button
          type="button"
          class="cursor-default rounded-sm border border-hair-strong px-2 py-[3px] text-[11.5px] font-medium text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="newFolder.cancel"
        >
          Cancel
        </button>
        <span v-if="newFolder.error.value" class="text-[11px] text-danger" role="alert">
          {{ newFolder.error.value }}
        </span>
      </form>

      <div
        class="fs-pane flex-1 overflow-y-auto p-2 transition-opacity"
        :class="listingQuery.isFetching.value && !showingThisPc && 'opacity-55'"
        @click.self="clearHighlight"
      >
        <p
          v-if="navigationError"
          class="fs-navigation-error m-0 mb-2 rounded-sm border border-hair bg-inset px-2 py-1.5 text-[11.5px] text-danger"
          role="alert"
        >
          {{ navigationError }}
        </p>
        <template v-if="showingThisPc">
          <p class="m-0 mb-1.5 px-1 text-[11.5px] font-medium text-ink-2">Devices and drives</p>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-1">
            <DriveTile
              v-for="drive in listing?.drives ?? []"
              :key="drive.path"
              :drive="drive"
              @open="openFolder(drive.path)"
            />
          </div>
        </template>

        <template v-else>
          <div
            class="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-1"
            @click.self="clearHighlight"
          >
            <FileSystemTile
              v-for="tile in [...folderTiles, ...fileTiles]"
              :key="tile.path"
              :kind="tile.kind"
              :name="tile.name"
              :selected="isSameSelection(highlighted, tile)"
              @select="highlight(tile)"
              @open="openFolder(tile.path)"
            />
          </div>
          <p v-if="isEmptyFolder" class="m-2 text-[11.5px] text-ink-3">
            {{ emptyText }}
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
