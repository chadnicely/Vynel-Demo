<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Eye, EyeOff, Plus, X } from "lucide-vue-next";
import { Modal } from "@vynel/ui";
import type { WorkspaceAppResponse } from "@vynel/contracts/apps/app-http";
import { useAppEnv } from "../../composables/workspace-apps/use-app-env.js";
import { useUpdateAppEnv } from "../../composables/workspace-apps/use-update-app-env.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The env popup for one app row: the app's env file parsed into editable
// key/value rows. Values are hidden until revealed (they're secrets on a
// screen that may be shared). Save sends the FULL desired set — the API
// rewrites the file line-preservingly, so comments in it survive.
const props = defineProps<{
  open: boolean;
  workspaceId: string;
  app: WorkspaceAppResponse;
}>();

const emit = defineEmits<{
  close: [];
}>();

const envQuery = useAppEnv(
  () => props.workspaceId,
  () => props.app.id,
  () => props.open,
);
const updateEnv = useUpdateAppEnv();

const rows = ref<{ key: string; value: string }[]>([]);
const showValues = ref(false);

// Seed the editable rows ONCE per open cycle, when THIS open's fetch has
// settled — a reopen briefly serves the cached previous file while the
// refetch runs, and seeding from that stale copy would make the full-state
// save silently revert edits made outside Vynel (Claude edits files
// directly). A refetch must never clobber edits in progress either.
const hasSeeded = ref(false);
watch(
  [
    () => props.open,
    () => envQuery.data.value,
    () => envQuery.isFetching.value,
  ],
  ([open, file, isFetching]) => {
    if (!open) {
      hasSeeded.value = false;
      showValues.value = false;
      updateEnv.reset();
      return;
    }
    if (file && !isFetching && !hasSeeded.value) {
      rows.value = file.entries.map((entry) => ({ ...entry }));
      hasSeeded.value = true;
    }
  },
  { immediate: true },
);

// Where the file lives, in the user's terms (folder + file name).
const filePath = computed(() =>
  props.app.cwdRelative.length > 0
    ? `${props.app.cwdRelative}/${props.app.envFileRelative}`
    : props.app.envFileRelative,
);

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isValidKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key.trim());
}

const hasInvalidKey = computed(() =>
  rows.value.some((row) => !isValidKey(row.key)),
);
const hasDuplicateKey = computed(() => {
  const keys = rows.value.map((row) => row.key.trim());
  return new Set(keys).size !== keys.length;
});

const canSave = computed(
  () =>
    hasSeeded.value &&
    !hasInvalidKey.value &&
    !hasDuplicateKey.value &&
    !updateEnv.isPending.value,
);

function addRow() {
  rows.value.push({ key: "", value: "" });
  showValues.value = true; // a fresh row is being typed — masking it is noise
}

function removeRow(index: number) {
  rows.value.splice(index, 1);
}

function save() {
  if (!canSave.value) return;
  updateEnv.mutate(
    {
      workspaceId: props.workspaceId,
      appId: props.app.id,
      entries: rows.value.map((row) => ({ key: row.key.trim(), value: row.value })),
    },
    { onSuccess: () => emit("close") },
  );
}

const errorMessage = computed(() => {
  const error = envQuery.error.value ?? updateEnv.error.value;
  return error ? formatSdkError(error) : null;
});

// Modal owns Esc / backdrop / focus-trap; it reports close via update:open.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="`Env for ${props.app.name}`"
    :description="`These live in ${filePath} — the file this app reads its settings from.`"
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-2.5 pt-1">
      <p
        v-if="envQuery.isPending.value && props.open"
        class="m-0 text-xs text-ink-3"
      >
        Reading the file…
      </p>

      <template v-else>
        <div class="flex items-center justify-between">
          <p
            v-if="envQuery.data.value && !envQuery.data.value.exists"
            class="m-0 text-[11.5px] text-ink-3"
          >
            No file yet — saving creates it.
          </p>
          <p v-else class="m-0 text-[11.5px] text-ink-3">
            {{ rows.length }} variable{{ rows.length === 1 ? "" : "s" }}
          </p>
          <button
            v-if="rows.length > 0"
            type="button"
            class="reveal-toggle inline-flex cursor-default items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-3 transition hover:text-ink-1"
            :aria-label="showValues ? 'Hide values' : 'Show values'"
            @click="showValues = !showValues"
          >
            <EyeOff v-if="showValues" :size="12" />
            <Eye v-else :size="12" />
            {{ showValues ? "Hide values" : "Show values" }}
          </button>
        </div>

        <div v-if="rows.length > 0" class="flex flex-col gap-1.5">
          <div
            v-for="(row, index) in rows"
            :key="index"
            class="env-row flex items-center gap-1.5"
          >
            <input
              v-model="row.key"
              type="text"
              maxlength="200"
              placeholder="KEY"
              :aria-label="`Variable ${index + 1} name`"
              class="w-2/5 rounded-sm border border-hair-strong bg-panel px-2 py-1.5 font-mono text-xs text-ink-1 placeholder:text-ink-3"
              :class="{ 'border-danger': row.key.length > 0 && !isValidKey(row.key) }"
            />
            <input
              v-model="row.value"
              :type="showValues ? 'text' : 'password'"
              maxlength="20000"
              placeholder="value"
              :aria-label="`Variable ${index + 1} value`"
              class="min-w-0 flex-1 rounded-sm border border-hair-strong bg-panel px-2 py-1.5 font-mono text-xs text-ink-1 placeholder:text-ink-3"
            />
            <button
              type="button"
              class="remove-row shrink-0 cursor-default rounded-md p-1 text-ink-3 transition hover:bg-row-hover hover:text-danger"
              :aria-label="`Remove variable ${index + 1}`"
              @click="removeRow(index)"
            >
              <X :size="13" />
            </button>
          </div>
        </div>

        <button
          type="button"
          class="add-row inline-flex cursor-default items-center gap-1.5 self-start rounded-full border border-hair px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="addRow"
        >
          <Plus :size="12" />
          Add variable
        </button>

        <p v-if="hasDuplicateKey" class="m-0 text-[11.5px] text-gold">
          Two variables share a name — each key must be unique.
        </p>
        <p v-else-if="hasInvalidKey" class="m-0 text-[11.5px] text-gold">
          Names are letters, digits and underscores, like DATABASE_URL.
        </p>
      </template>

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
        {{ updateEnv.isPending.value ? "Saving…" : "Save" }}
      </button>
    </template>
  </Modal>
</template>
