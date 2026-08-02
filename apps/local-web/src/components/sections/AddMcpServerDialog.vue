<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useAddMcpServer } from "../../composables/mcp-servers/use-add-mcp-server.js";
import type { AddMcpServerBody } from "../../composables/mcp-servers/use-add-mcp-server.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import KeyValueRowsField from "./KeyValueRowsField.vue";
import type { KeyValueRow } from "./KeyValueRowsField.vue";
import type { SectionScope } from "./section-scope.js";

// Add a custom MCP server: a local command (stdio) or a remote https endpoint
// (http/sse) with auth as static headers — written straight into the Claude
// config for the surface it was opened from (headers-in-config, Chad
// 2026-08-02; OAuth deferred). Secrets leave this form exactly once, in the
// POST; every read back is masked.
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
}>();

type Transport = "stdio" | "http" | "sse";
const TRANSPORTS: { id: Transport; label: string }[] = [
  { id: "stdio", label: "Local command" },
  { id: "http", label: "Remote (HTTP)" },
  { id: "sse", label: "Remote (SSE)" },
];

const serverName = ref("");
const transport = ref<Transport>("stdio");
const command = ref("");
const argsText = ref("");
const url = ref("");
const headerRows = ref<KeyValueRow[]>([]);
const envRows = ref<KeyValueRow[]>([]);

const addServer = useAddMcpServer();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    serverName.value = "";
    transport.value = "stdio";
    command.value = "";
    argsText.value = "";
    url.value = "";
    headerRows.value = [];
    envRows.value = [];
    addServer.reset();
  },
  { immediate: true },
);

const isRemote = computed(() => transport.value !== "stdio");

// Mirrors the server's policy (https only; loopback http exempt) so the form
// teaches before the request round-trips — the server still enforces.
const urlError = computed(() => {
  if (!isRemote.value || url.value.trim() === "") return null;
  try {
    const parsed = new URL(url.value.trim());
    if (parsed.protocol === "https:") return null;
    if (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
      return null;
    return "Remote servers need an https:// URL (plain http is allowed only for localhost).";
  } catch {
    return "That doesn't look like a valid URL.";
  }
});

const canSubmit = computed(() => {
  if (serverName.value.trim() === "" || addServer.isPending.value) return false;
  if (isRemote.value) return url.value.trim() !== "" && urlError.value === null;
  return command.value.trim() !== "";
});

const errorMessage = computed(() =>
  addServer.error.value ? formatSdkError(addServer.error.value) : null,
);

function toRecord(rows: KeyValueRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    if (row.name.trim() !== "") record[row.name.trim()] = row.value;
  }
  return record;
}

function submit() {
  if (!canSubmit.value) return;
  const body: AddMcpServerBody =
    transport.value === "stdio"
      ? {
          serverName: serverName.value.trim(),
          transport: "stdio",
          command: command.value.trim(),
          args: argsText.value
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== ""),
          environment: toRecord(envRows.value),
        }
      : {
          serverName: serverName.value.trim(),
          transport: transport.value,
          url: url.value.trim(),
          headers: toRecord(headerRows.value),
        };
  addServer.mutate(
    props.defaultScope.kind === "workspace"
      ? {
          scope: "workspace",
          workspaceId: props.defaultScope.workspaceId,
          body,
        }
      : { scope: "user", body },
    { onSuccess: () => emit("close") },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Add an MCP server"
    description="Connect a tool server Claude can call — a local command, or a remote endpoint with your auth headers."
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="serverName"
          type="text"
          maxlength="120"
          autofocus
          placeholder="e.g. linear"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <p
        v-if="props.defaultScope.kind === 'workspace'"
        class="teaching-note m-0 text-[11px] text-ink-3"
      >
        This writes a .mcp.json file inside the workspace's folder — if that
        folder is a git project, the file can be committed along with it, so
        keep your own .gitignore in mind when the server carries secrets.
      </p>

      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Kind</span>
        <div class="flex flex-wrap gap-1.5" role="group" aria-label="Transport">
          <button
            v-for="option in TRANSPORTS"
            :key="option.id"
            type="button"
            class="cursor-default rounded-full border px-3 py-1 text-[11.5px] font-medium transition"
            :class="
              transport === option.id
                ? 'border-gold bg-gold-soft text-ink-1'
                : 'border-hair bg-panel text-ink-2 hover:border-hair-strong hover:text-ink-1'
            "
            :aria-pressed="transport === option.id"
            @click="transport = option.id"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <template v-if="!isRemote">
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">Command</span>
          <input
            v-model="command"
            type="text"
            placeholder="e.g. npx"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
          />
        </label>
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">
            Arguments
            <span class="text-[10px] font-medium uppercase tracking-wide text-ink-3">one per line</span>
          </span>
          <textarea
            v-model="argsText"
            rows="2"
            placeholder="@playwright/mcp@latest"
            class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12px] text-ink-1 placeholder:text-ink-3"
          />
        </label>
        <KeyValueRowsField
          v-model:rows="envRows"
          label="Environment variables"
          name-placeholder="NAME"
          value-placeholder="value"
          add-label="Add variable"
        />
      </template>

      <template v-else>
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">Server URL</span>
          <input
            v-model="url"
            type="url"
            placeholder="https://example.com/mcp"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
          />
          <span v-if="urlError" class="text-[11px] text-danger">{{ urlError }}</span>
        </label>
        <KeyValueRowsField
          v-model:rows="headerRows"
          label="Auth headers"
          name-placeholder="Authorization"
          value-placeholder="Bearer …"
          add-label="Add header"
        />
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
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ addServer.isPending.value ? "Adding…" : "Add server" }}
      </button>
    </template>
  </Modal>
</template>
