<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { WorkspaceAppResponse } from "@vynel/contracts/apps/app-http";
import { useAddApp } from "../../composables/workspace-apps/use-add-app.js";
import { useUpdateApp } from "../../composables/workspace-apps/use-update-app.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Add or edit one app — the same four fields either way. `app` present means
// edit (prefilled); absent means add. Copy speaks to non-technical users: the
// command usually comes from Claude, but the fields never assume it did.
const props = defineProps<{
  open: boolean;
  workspaceId: string;
  app?: WorkspaceAppResponse | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const name = ref("");
const command = ref("");
const folder = ref("");
// Kept as a string so "empty" (no port) stays distinct from an invalid entry.
const port = ref("");

const addApp = useAddApp();
const updateApp = useUpdateApp();

// `immediate` covers a dialog mounted already-open (the watcher would
// otherwise never seed the fields).
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.app?.name ?? "";
    command.value = props.app?.command ?? "";
    folder.value = props.app?.cwdRelative ?? "";
    port.value = props.app?.port !== null && props.app?.port !== undefined
      ? String(props.app.port)
      : "";
    addApp.reset();
    updateApp.reset();
  },
  { immediate: true },
);

// null = no port, a number = valid, undefined = the entry can't be a port.
const parsedPort = computed(() => {
  const entry = port.value.trim();
  if (entry === "") return null;
  const value = Number(entry);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return undefined;
  return value;
});

const isPending = computed(
  () => addApp.isPending.value || updateApp.isPending.value,
);

const canSave = computed(
  () =>
    name.value.trim().length > 0 &&
    command.value.trim().length > 0 &&
    parsedPort.value !== undefined &&
    !isPending.value,
);

const errorMessage = computed(() => {
  const error = addApp.error.value ?? updateApp.error.value;
  return error ? formatSdkError(error) : null;
});

function save() {
  if (!canSave.value) return;
  const fields = {
    name: name.value.trim(),
    command: command.value.trim(),
  };
  const cwdRelative = folder.value.trim();
  if (props.app) {
    // Edit sends the whole form — an emptied port clears it (null), an
    // emptied folder goes back to the workspace root ('').
    updateApp.mutate(
      {
        workspaceId: props.workspaceId,
        appId: props.app.id,
        ...fields,
        cwdRelative,
        port: typeof parsedPort.value === "number" ? parsedPort.value : null,
      },
      { onSuccess: () => emit("saved") },
    );
    return;
  }
  addApp.mutate(
    {
      workspaceId: props.workspaceId,
      ...fields,
      ...(cwdRelative.length > 0 ? { cwdRelative } : {}),
      ...(typeof parsedPort.value === "number"
        ? { port: parsedPort.value }
        : {}),
    },
    { onSuccess: () => emit("saved") },
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
    :title="props.app ? 'Edit app' : 'Add an app'"
    description="Vynel starts it for you, keeps an eye on it, and shows you what it prints."
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2"
          >What should we call it?</span
        >
        <input
          v-model="name"
          type="text"
          maxlength="60"
          autofocus
          placeholder="e.g. Web app"
          aria-label="App name"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2"
          >The command that starts it</span
        >
        <input
          v-model="command"
          type="text"
          maxlength="500"
          placeholder="e.g. npm run dev"
          aria-label="Start command"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">
          Folder
          <span
            class="text-[10px] font-medium uppercase tracking-wide text-ink-3"
            >optional</span
          >
        </span>
        <input
          v-model="folder"
          type="text"
          maxlength="300"
          placeholder="e.g. apps/web"
          aria-label="Folder"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
        <span class="text-[11px] text-ink-3"
          >Inside the workspace — leave empty for the main folder.</span
        >
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">
          Port
          <span
            class="text-[10px] font-medium uppercase tracking-wide text-ink-3"
            >optional</span
          >
        </span>
        <input
          v-model="port"
          type="text"
          inputmode="numeric"
          placeholder="e.g. 3000"
          aria-label="Port"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
        <span class="text-[11px] text-ink-3"
          >If it opens in the browser, its port powers the "Open in browser"
          link.</span
        >
        <p
          v-if="parsedPort === undefined"
          class="m-0 text-[11.5px] text-gold"
        >
          A port is a whole number between 1 and 65535.
        </p>
      </label>

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
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canSave"
        @click="save"
      >
        <template v-if="props.app">{{
          isPending ? "Saving…" : "Save changes"
        }}</template>
        <template v-else>{{ isPending ? "Adding…" : "Add app" }}</template>
      </button>
    </template>
  </Modal>
</template>
