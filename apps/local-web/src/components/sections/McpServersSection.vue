<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhPlugsConnected as Cable,
  PhCheck as Check,
  PhPlus as Plus,
  PhX as X,
} from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import { useLoginMcpServer } from "../../composables/mcp-servers/use-login-mcp-server.js";
import { useMcpServers } from "../../composables/mcp-servers/use-mcp-servers.js";
import { useRemoveMcpServer } from "../../composables/mcp-servers/use-remove-mcp-server.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import AddMcpServerDialog from "./AddMcpServerDialog.vue";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

// The MCP servers a surface OWNS — the entries in ITS OWN Claude config (a
// workspace's `.mcp.json`, or `~/.claude.json` on the global menu),
// marketplace-installed and hand-added alike, each with transport + scope
// chips and a command-or-url summary. One config file per surface, so removing
// here can only touch the file this surface speaks for. SECRETS STAY MASKED:
// the API sends header NAMES + presence only, so a value can never render.
const props = defineProps<{
  scope: SectionScope;
}>();

const serversQuery = useMcpServers(() => props.scope);
const servers = computed(() => serversQuery.data.value ?? []);

const { scopeLabel } = useScopeLabel();

function scopeChip(rowScope: "user" | "workspace"): string {
  if (rowScope === "user") return "Global";
  return props.scope.kind === "workspace"
    ? scopeLabel(props.scope.workspaceId)
    : "Workspace";
}

function summaryOf(server: {
  transport: string;
  commandOrUrl: string;
  args: string[];
}): string {
  return server.transport === "stdio"
    ? [server.commandOrUrl, ...server.args].join(" ")
    : server.commandOrUrl;
}

const removeServer = useRemoveMcpServer();

// Removing edits a config file the user may not have a copy of — the X arms
// first ("Sure?"), a second explicit click fires (the notebook idiom).
const armedRemoveKey = ref<string | null>(null);

function rowKey(server: { scope: string; serverName: string }): string {
  return `${server.scope}:${server.serverName}`;
}

function requestRemove(server: { scope: "user" | "workspace"; serverName: string }) {
  const key = rowKey(server);
  if (armedRemoveKey.value !== key) {
    armedRemoveKey.value = key;
    return;
  }
  armedRemoveKey.value = null;
  // The row's OWN scope picks the config file. Each surface now lists only
  // what it owns, so the workspace branch is the only one a room can reach —
  // the user branch serves the Global menu, whose rows carry scope 'user'.
  removeServer.mutate(
    server.scope === "workspace" && props.scope.kind === "workspace"
      ? {
          scope: "workspace",
          workspaceId: props.scope.workspaceId,
          serverName: server.serverName,
        }
      : { scope: "user", serverName: server.serverName },
  );
}

// Connect (remote rows): the native browser sign-in via the daemon — the
// marketplace card's twin, here for hand-added servers too. The SAME button
// refreshes an existing sign-in (idempotent; the CLI stores a fresh
// credential), which is the "update auth" affordance. The resting state
// comes from the row's persisted `signedIn` (the daemon's metadata-only
// read of Claude's credential store); `connectedKey` bridges the instant
// after a successful login until the invalidated listing lands.
const loginServer = useLoginMcpServer();
const connectedKey = ref<string | null>(null);

function isSignedIn(server: {
  scope: string;
  serverName: string;
  signedIn: boolean;
}): boolean {
  return server.signedIn || connectedKey.value === rowKey(server);
}

function requestConnect(server: { scope: "user" | "workspace"; serverName: string }) {
  connectedKey.value = null;
  loginServer.mutate(
    server.scope === "workspace" && props.scope.kind === "workspace"
      ? {
          scope: "workspace",
          workspaceId: props.scope.workspaceId,
          serverName: server.serverName,
        }
      : { scope: "user", serverName: server.serverName },
    { onSuccess: () => (connectedKey.value = rowKey(server)) },
  );
}

function isConnecting(server: { scope: string; serverName: string }): boolean {
  return (
    loginServer.isPending.value &&
    loginServer.variables.value?.serverName === server.serverName
  );
}

const errorMessage = computed(() => {
  if (removeServer.error.value) return formatSdkError(removeServer.error.value);
  if (loginServer.error.value) return formatSdkError(loginServer.error.value);
  return null;
});

const isAddOpen = ref(false);

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Tool servers Claude can reach in every workspace"
    : "Tool servers it can reach from this workspace",
);
</script>

<template>
  <div class="mcp-servers-section flex flex-col gap-2.5">
    <SectionHeader :icon="Cable" title="MCP Servers" :subtitle="sectionHint">
      <template #actions>
        <button
          type="button"
          class="add-server inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-3 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="isAddOpen = true"
        >
          <Plus :size="13" />
          Add server
        </button>
      </template>
    </SectionHeader>

    <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
      {{ errorMessage }}
    </p>

    <div v-if="servers.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="server in servers"
        :key="rowKey(server)"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-ws-3/12 text-ws-3"
        >
          <Cable :size="17" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p
              class="row-title m-0 truncate font-mono text-[13px] font-semibold text-ink-1"
            >
              {{ server.serverName }}
            </p>
            <span
              class="transport-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ server.transport }}</span
            >
            <span
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeChip(server.scope) }}</span
            >
          </div>
          <p class="row-sub m-0 mt-0.5 truncate font-mono text-[11.5px] text-ink-3">
            {{ summaryOf(server) }}
          </p>
          <div
            v-if="server.headers.length > 0 || server.environmentKeys.length > 0"
            class="mt-1 flex flex-wrap items-center gap-1"
          >
            <!-- Names + presence only — the wire never carried the values. -->
            <span
              v-for="header in server.headers"
              :key="header.name"
              class="header-chip inline-flex items-center gap-1 rounded-full border border-hair px-1.5 py-px font-mono text-[10px] text-ink-3"
              >{{ header.name }}:
              <span aria-label="hidden value">{{ header.hasValue ? "••••••" : "(empty)" }}</span></span
            >
            <span
              v-for="envKey in server.environmentKeys"
              :key="envKey"
              class="env-chip inline-flex items-center gap-1 rounded-full border border-hair px-1.5 py-px font-mono text-[10px] text-ink-3"
              >{{ envKey }}=<span aria-label="hidden value">••••••</span></span
            >
          </div>
        </div>
        <!-- Remote servers sign in through the native browser flow; the
             same button refreshes an existing sign-in (update auth). -->
        <button
          v-if="server.transport !== 'stdio'"
          type="button"
          class="connect-button inline-flex shrink-0 cursor-default items-center gap-1 rounded-full px-2.5 py-px text-[11px] font-semibold transition disabled:opacity-55"
          :class="
            isSignedIn(server)
              ? 'bg-ok/15 text-ok hover:bg-ok/25'
              : 'bg-info/15 text-info hover:bg-info/25'
          "
          :disabled="isConnecting(server)"
          :title="
            isSignedIn(server)
              ? `${server.serverName} is signed in — click to refresh the sign-in`
              : `Connect or refresh the sign-in for ${server.serverName}`
          "
          :aria-label="`Connect ${server.serverName} — opens your browser to sign in`"
          @click="requestConnect(server)"
        >
          <Check v-if="isSignedIn(server) && !isConnecting(server)" :size="11" />
          {{
            isConnecting(server)
              ? "Connecting…"
              : isSignedIn(server)
                ? "Connected"
                : "Connect"
          }}
        </button>
        <button
          type="button"
          class="remove-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          :class="{ '!opacity-100 text-danger': armedRemoveKey === rowKey(server) }"
          :title="`Remove ${server.serverName}`"
          :aria-label="`Remove ${server.serverName}`"
          @blur="armedRemoveKey === rowKey(server) && (armedRemoveKey = null)"
          @click="requestRemove(server)"
        >
          <span v-if="armedRemoveKey === rowKey(server)" class="px-1 text-[11px] font-semibold"
            >Sure?</span
          >
          <X v-else :size="14" />
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="No MCP servers yet"
      hint="MCP servers give Claude extra tools — browse the Marketplace, or add your own local command or remote endpoint."
    >
      <template #icon>
        <Cable :size="22" />
      </template>
    </EmptyState>

    <AddMcpServerDialog
      :open="isAddOpen"
      :default-scope="props.scope"
      @close="isAddOpen = false"
    />
  </div>
</template>
