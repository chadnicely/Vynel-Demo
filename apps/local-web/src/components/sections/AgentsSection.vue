<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhFileText as FileText,
  PhPencilSimple as Pencil,
  PhPlus as Plus,
  PhRobot as Bot,
  PhX as X,
} from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import { useAgents } from "../../composables/agents/use-agents.js";
import { useAgentFiles } from "../../composables/agents/use-agent-files.js";
import { useSetAgentEnabled } from "../../composables/agents/use-set-agent-enabled.js";
import {
  useDeleteAgent,
  useDeleteAgentFile,
} from "../../composables/agents/use-agent-mutations.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import CuratedAgentsDialog from "./CuratedAgentsDialog.vue";
import EditAgentFileDialog from "./EditAgentFileDialog.vue";
import WriteAgentDialog from "./WriteAgentDialog.vue";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

// The agents section, on either surface: the global menu shows the user-scope
// specialists (available in every workspace); a workspace drawer shows the
// ones added to THAT room. Two kinds of row share the shelf: Vynel agents
// (DB rows — curated installs, marketplace installs, ones built here; each
// wearing a provenance chip and the On/Off pill, and each mirrored to
// `.claude/agents/<slug>.md`) and the user's HAND-AUTHORED agent files
// ("On disk" chip, always live, edited raw). Build, edit, delete and the
// curated catalog are the human doors the API had all along.
const props = defineProps<{
  scope: SectionScope;
}>();

const agentsQuery = useAgents(() => props.scope);
const agents = computed(() => agentsQuery.data.value ?? []);
const agentFilesQuery = useAgentFiles(() => props.scope);
const agentFiles = computed(() => agentFilesQuery.data.value ?? []);
const isEmpty = computed(() => agents.value.length === 0 && agentFiles.value.length === 0);

const { scopeLabel } = useScopeLabel();

// Provenance chip per source. User-built agents wear none — "yours" is the
// default; the chip marks what arrived from elsewhere (marketplace idiom).
const SOURCE_LABELS: Record<string, string> = {
  vynel: "Curated",
  community: "Community",
};

const setEnabled = useSetAgentEnabled();
const deleteAgent = useDeleteAgent();
const deleteAgentFile = useDeleteAgentFile();

function toggleAgent(agent: { id: string; enabled: boolean }) {
  setEnabled.mutate({ agentId: agent.id, enabled: !agent.enabled });
}

type AgentRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  allowedTools: string[] | null;
};
type AgentFileRow = { slug: string; content: string };

const isWriteOpen = ref(false);
const editingAgent = ref<AgentRow | null>(null);
const isCuratedOpen = ref(false);
const isFileOpen = ref(false);
const editingFile = ref<AgentFileRow | null>(null);

function startBuilding() {
  editingAgent.value = null;
  isWriteOpen.value = true;
}

function startEditing(agent: AgentRow) {
  editingAgent.value = {
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    prompt: agent.prompt,
    model: agent.model,
    allowedTools: agent.allowedTools,
  };
  isWriteOpen.value = true;
}

function startWritingFile() {
  editingFile.value = null;
  isFileOpen.value = true;
}

function startEditingFile(file: AgentFileRow) {
  editingFile.value = { slug: file.slug, content: file.content };
  isFileOpen.value = true;
}

function onSaved() {
  isWriteOpen.value = false;
  editingAgent.value = null;
  isFileOpen.value = false;
  editingFile.value = null;
}

// Deleting is gone-for-good (the file leaves disk either way) — the armed
// "Sure?" idiom: first click arms, second fires, blur disarms.
const armedDeleteKey = ref<string | null>(null);

function requestDeleteAgent(agent: { id: string }) {
  const key = `agent:${agent.id}`;
  if (armedDeleteKey.value !== key) {
    armedDeleteKey.value = key;
    return;
  }
  armedDeleteKey.value = null;
  deleteAgent.mutate({ agentId: agent.id });
}

function requestDeleteFile(file: { slug: string }) {
  const key = `file:${file.slug}`;
  if (armedDeleteKey.value !== key) {
    armedDeleteKey.value = key;
    return;
  }
  armedDeleteKey.value = null;
  deleteAgentFile.mutate({
    slug: file.slug,
    scope:
      props.scope.kind === "workspace"
        ? { scope: "workspace", workspaceId: props.scope.workspaceId }
        : { scope: "user" },
  });
}

function disarm(key: string) {
  if (armedDeleteKey.value === key) armedDeleteKey.value = null;
}

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Specialists Claude can delegate to, in every workspace"
    : "Specialists added to this workspace",
);
</script>

<template>
  <div class="agents-section flex flex-col gap-2.5">
    <SectionHeader :icon="Bot" title="Agents" :subtitle="sectionHint">
      <template v-if="!isEmpty" #actions>
        <button
          type="button"
          class="catalog-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-3 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="isCuratedOpen = true"
        >
          Catalog
        </button>
        <button
          type="button"
          class="build-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-3 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="startBuilding"
        >
          <Plus :size="13" />
          Build an agent
        </button>
      </template>
    </SectionHeader>

    <div v-if="!isEmpty" class="rows flex flex-col gap-2">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-ok/10 text-ok"
        >
          <Bot :size="17" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
              {{ agent.name }}
            </p>
            <span
              v-if="SOURCE_LABELS[agent.source]"
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
            >
              {{ SOURCE_LABELS[agent.source] }}
            </span>
            <span
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeLabel(agent.workspaceId) }}</span
            >
          </div>
          <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
            {{ agent.description }}
          </p>
        </div>
        <button
          type="button"
          class="icon-button edit-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
          :title="`Edit ${agent.name}`"
          :aria-label="`Edit ${agent.name}`"
          @click="startEditing(agent)"
        >
          <Pencil :size="13" />
        </button>
        <button
          type="button"
          :class="
            armedDeleteKey === `agent:${agent.id}`
              ? 'row-action delete-button is-danger inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-3 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
              : 'icon-button delete-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100'
          "
          :aria-label="
            armedDeleteKey === `agent:${agent.id}`
              ? `Confirm delete ${agent.name}`
              : `Delete ${agent.name}`
          "
          @click="requestDeleteAgent(agent)"
          @blur="disarm(`agent:${agent.id}`)"
        >
          <template v-if="armedDeleteKey === `agent:${agent.id}`">Sure?</template>
          <X v-else :size="13" />
        </button>
        <button
          type="button"
          class="pill shrink-0 cursor-default rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          :class="
            agent.enabled
              ? 'is-on bg-ok/15 text-ok'
              : 'is-off bg-row-active text-ink-3'
          "
          :aria-label="`Turn ${agent.name} ${agent.enabled ? 'off' : 'on'}`"
          @click="toggleAgent(agent)"
        >
          {{ agent.enabled ? "On" : "Off" }}
        </button>
      </div>

      <div
        v-for="file in agentFiles"
        :key="`file:${file.slug}`"
        class="row file-row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-ws-3/12 text-ws-3"
        >
          <FileText :size="17" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
              {{ file.name }}
            </p>
            <span
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >On disk</span
            >
          </div>
          <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
            {{ file.description ?? file.fileName }}
          </p>
        </div>
        <button
          type="button"
          class="icon-button edit-file-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
          :title="`Edit ${file.fileName}`"
          :aria-label="`Edit ${file.fileName}`"
          @click="startEditingFile(file)"
        >
          <Pencil :size="13" />
        </button>
        <button
          type="button"
          :class="
            armedDeleteKey === `file:${file.slug}`
              ? 'row-action delete-file-button is-danger inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-3 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
              : 'icon-button delete-file-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100'
          "
          :aria-label="
            armedDeleteKey === `file:${file.slug}`
              ? `Confirm delete ${file.fileName}`
              : `Delete ${file.fileName}`
          "
          @click="requestDeleteFile(file)"
          @blur="disarm(`file:${file.slug}`)"
        >
          <template v-if="armedDeleteKey === `file:${file.slug}`">Sure?</template>
          <X v-else :size="13" />
        </button>
      </div>

      <button
        type="button"
        class="write-file-button inline-flex cursor-default items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[11px] text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
        @click="startWritingFile"
      >
        <FileText :size="12" />
        Write an agent file by hand
      </button>
    </div>

    <EmptyState
      v-else
      title="No agents yet"
      hint="Build a specialist Claude can delegate focused work to — research, writing, whatever the task calls for — or add one from the catalog."
    >
      <template #icon>
        <Bot :size="22" />
      </template>
      <template #action>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="invite-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
            @click="startBuilding"
          >
            <Plus :size="13" />
            Build an agent
          </button>
          <button
            type="button"
            class="catalog-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
            @click="isCuratedOpen = true"
          >
            Catalog
          </button>
        </div>
      </template>
    </EmptyState>

    <WriteAgentDialog
      :open="isWriteOpen"
      :default-scope="props.scope"
      :editing="editingAgent"
      @close="onSaved"
      @saved="onSaved"
    />
    <EditAgentFileDialog
      :open="isFileOpen"
      :scope="props.scope"
      :editing="editingFile"
      @close="onSaved"
      @saved="onSaved"
    />
    <CuratedAgentsDialog
      :open="isCuratedOpen"
      :scope="props.scope"
      :installed-slugs="agents.map((agent) => agent.slug)"
      @close="isCuratedOpen = false"
    />
  </div>
</template>
