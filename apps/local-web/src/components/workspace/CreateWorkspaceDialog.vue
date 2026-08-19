<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import FileSystemBrowser from "../filesystem/FileSystemBrowser.vue";
import { isDriveRootPath } from "../filesystem/file-system-path.js";
import type { FileSystemSelection } from "../filesystem/file-system-selection.js";
import { useDirectoryListing } from "../../composables/workspaces/use-directory-listing.js";
import { useRegisterWorkspace } from "../../composables/workspaces/use-register-workspace.js";
import {
  useWorkspaceGroupMutations,
  useWorkspaceGroups,
} from "../../composables/workspaces/use-workspace-groups.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The "New workspace" dialog: pick the folder in the Explorer-style browser,
// the name fills itself from that folder (edit it if you like), file it into
// a group (an existing one, or make a new group right here), Continue.
const props = defineProps<{
  open: boolean;
  /** The group a tree "+" was clicked on — the starting pick; null = root. */
  defaultGroupId?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  created: [workspace: WorkspaceResponse];
}>();

const selection = ref<FileSystemSelection | null>(null);
const name = ref("");
// Once the user types a name it stops following the folder; clearing it
// hands control back to the folder.
const nameEdited = ref(false);

const isOpen = computed(() => props.open);
// The same home read the browser opens with (shared query cache) — it carries
// the known places, and Home is the one folder a workspace must not swallow.
const homeListing = useDirectoryListing(ref(null), isOpen);
const registerWorkspace = useRegisterWorkspace();
const groupsQuery = useWorkspaceGroups();
const groupMutations = useWorkspaceGroupMutations();

// ── Group: an existing one, the root, or a new group made inline. ──
const NEW_GROUP_OPTION = "__new__";
const groupId = ref<string | null>(null);
const isNamingGroup = ref(false);
const newGroupName = ref("");
const groups = computed(() => groupsQuery.data.value ?? []);

function onGroupPicked(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === NEW_GROUP_OPTION) {
    isNamingGroup.value = true;
    newGroupName.value = "";
    return;
  }
  isNamingGroup.value = false;
  groupId.value = value === "" ? null : value;
}

function createGroup() {
  const name = newGroupName.value.trim();
  if (name.length === 0 || groupMutations.createGroup.isPending.value) return;
  groupMutations.createGroup.mutate(name, {
    onSuccess: (group) => {
      groupId.value = group.id;
      isNamingGroup.value = false;
      newGroupName.value = "";
    },
  });
}

function cancelNewGroup() {
  isNamingGroup.value = false;
  newGroupName.value = "";
  groupMutations.createGroup.reset();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      selection.value = null;
      name.value = "";
      nameEdited.value = false;
      groupId.value = props.defaultGroupId ?? null;
      cancelNewGroup();
      registerWorkspace.reset();
    }
  },
  { immediate: true },
);

const homePath = computed(
  () => homeListing.data.value?.places.find((place) => place.kind === "home")?.path ?? null,
);
// A whole drive or the home folder isn't a room — it's the whole house.
const isTooBroad = computed(
  () =>
    selection.value !== null &&
    (isDriveRootPath(selection.value.path) || selection.value.path === homePath.value),
);

// The name the folder suggests — nothing while the pick is too broad to be one.
const suggestedName = computed(() =>
  selection.value && !isTooBroad.value ? selection.value.name : "",
);
watch(suggestedName, (suggested) => {
  if (!nameEdited.value) name.value = suggested;
});

function onNameInput(event: Event) {
  const typed = (event.target as HTMLInputElement).value;
  nameEdited.value = typed.trim().length > 0;
  if (!nameEdited.value) name.value = suggestedName.value;
}

const canCreate = computed(
  () =>
    selection.value !== null &&
    !isTooBroad.value &&
    name.value.trim().length > 0 &&
    !registerWorkspace.isPending.value,
);

const errorMessage = computed(() => {
  const error = registerWorkspace.error.value ?? groupMutations.createGroup.error.value;
  return error ? formatSdkError(error) : null;
});

function create() {
  if (!canCreate.value || selection.value === null) return;
  registerWorkspace.mutate(
    {
      name: name.value.trim(),
      directory: selection.value.path,
      ...(groupId.value !== null ? { groupId: groupId.value } : {}),
    },
    {
      onSuccess: (workspace) => emit("created", workspace as WorkspaceResponse),
    },
  );
}

// Modal owns Esc / backdrop / focus-trap / scroll-lock; it reports close via
// update:open, which we forward to the parent as `close`.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="New workspace"
    description="A room for one area of your life or work — its own files, memory, and skills."
    size="xl"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Folder</span>
        <FileSystemBrowser v-model="selection" mode="folder" :active="props.open" />
        <span v-if="isTooBroad" class="text-[11px] text-needs-input">
          That's your whole {{ selection && isDriveRootPath(selection.path) ? "drive" : "home folder" }} —
          open it and pick the folder this workspace should live in.
        </span>
        <span v-else class="text-[11px] text-ink-3">
          Click a folder to choose it, double-click to open it. The chosen folder is
          the one Claude works in.
        </span>
      </div>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="name"
          type="text"
          maxlength="120"
          placeholder="Picked from the folder — change it if you like"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @input="onNameInput"
          @keydown.enter.prevent="create"
        />
      </label>

      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Group</span>
        <div class="flex items-center gap-2">
          <select
            class="group-select h-7 cursor-default rounded-sm border border-hair-strong bg-panel px-1.5 text-[12px] text-ink-1 transition focus:outline-none"
            :value="isNamingGroup ? NEW_GROUP_OPTION : (groupId ?? '')"
            aria-label="Group"
            @change="onGroupPicked"
          >
            <option value="">No group</option>
            <option v-for="group in groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
            <option :value="NEW_GROUP_OPTION">＋ New group…</option>
          </select>
          <template v-if="isNamingGroup">
            <input
              v-model="newGroupName"
              type="text"
              maxlength="60"
              placeholder="Group name"
              aria-label="New group name"
              class="new-group-name h-7 min-w-0 flex-1 rounded-sm border border-hair-strong bg-panel px-2 text-[12px] text-ink-1 placeholder:text-ink-3"
              @keydown.enter.prevent="createGroup"
              @keydown.esc.prevent="cancelNewGroup"
            />
            <button
              type="button"
              class="new-group-create cursor-default rounded-sm border border-hair-strong px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-55"
              :disabled="newGroupName.trim().length === 0 || groupMutations.createGroup.isPending.value"
              @click="createGroup"
            >
              {{ groupMutations.createGroup.isPending.value ? "Creating…" : "Create group" }}
            </button>
          </template>
        </div>
        <span class="text-[11px] text-ink-3">
          Groups keep related workspaces together in the left menu.
        </span>
      </div>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="create cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canCreate"
        @click="create"
      >
        {{ registerWorkspace.isPending.value ? "Creating…" : "Continue" }}
      </button>
    </template>
  </Modal>
</template>
