<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  formatManagerLabel,
  resolveManagerName,
} from "@vynel/contracts/workspaces/manager-name";
import { useWorkingRail, type RailEntity } from "../../composables/activity/use-working-rail.js";
import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
import { usePersonaResolver } from "../../composables/personas/resolve-persona.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";

// The working rail (redesign): one small icon per ACTIVE entity — workspaces,
// sessions, colleagues, the brain — appearing while work runs and gone the
// moment it completes. Click → the entity's REAL conversation (the sidebar);
// the brain → the global thread. Gold ring = working (presence), amber dot =
// waiting on you. Strictly what's active NOW: an empty rail renders nothing.
const { entities } = useWorkingRail();
const sidebar = useConversationSidebarStore();
const router = useRouter();
const { resolvePersona } = usePersonaResolver();

const workspacesQuery = useWorkspaceList();
function labelOf(entity: RailEntity): string {
  if (entity.kind === "workspace") {
    const workspace = (workspacesQuery.data.value ?? []).find(
      (row) => row.id === entity.workspaceId,
    );
    if (workspace !== undefined) {
      return formatManagerLabel(resolveManagerName(workspace), workspace.name);
    }
  }
  return entity.label === "" ? "Working…" : entity.label;
}

const rows = computed(() =>
  entities.value.map((entity) => ({
    entity,
    label: labelOf(entity),
    persona: resolvePersona({ name: labelOf(entity), workspaceId: null }),
  })),
);

function openEntity(entity: RailEntity) {
  if (entity.kind === "brain") {
    void router.push({ name: "chat" });
    return;
  }
  if (entity.kind === "workspace") {
    sidebar.openWorkspace({ workspaceId: entity.workspaceId });
    return;
  }
  if (entity.segmentId !== null) {
    sidebar.openSession({ sessionId: entity.segmentId, title: labelOf(entity) });
  }
  // No conversation yet (an unlinked primary — a seconds-wide creation
  // window): a quiet no-op; the next poll resolves the segment.
}
</script>

<template>
  <aside
    v-if="rows.length > 0"
    class="working-rail"
    aria-label="Working now"
    data-testid="working-rail"
  >
    <span class="rail-label" aria-hidden="true">WORKING</span>
    <button
      v-for="row in rows"
      :key="row.entity.key"
      type="button"
      class="rail-icon"
      :class="{ 'is-working': row.entity.isWorking }"
      :title="`${row.label}${row.entity.isWorking ? '' : ' — queued'}`"
      :data-entity-kind="row.entity.kind"
      @click="openEntity(row.entity)"
    >
      <span
        class="rail-monogram"
        :style="{ color: `var(${row.persona.accentVar})` }"
      >
        {{ row.entity.kind === "brain" ? "✦" : row.persona.monogram }}
      </span>
      <span
        v-if="row.entity.isColleague"
        class="rail-agent-badge"
        aria-label="agent"
      />
      <span v-if="row.entity.hasAttention" class="rail-attention" aria-label="waiting on you" />
    </button>
  </aside>
</template>

<style scoped>
.working-rail {
  position: fixed;
  top: 96px;
  right: 8px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
}
.rail-label {
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--ink-3);
  writing-mode: vertical-rl;
  opacity: 0.7;
}
.rail-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--hair);
  border-radius: 8px;
  background: var(--bg-raised);
  cursor: pointer;
  transition: border-color 120ms ease;
}
.rail-icon:hover {
  border-color: var(--hair-strong, var(--hair));
}
/* Gold = presence: the ring breathes only while the entity is WORKING; a
   queued entity sits quiet. */
.rail-icon.is-working {
  border-color: var(--gold);
  animation: rail-breathe 1.8s ease-in-out infinite;
}
@keyframes rail-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(0 0 0 / 0);
  }
  50% {
    box-shadow: 0 0 6px 0 var(--gold-soft);
  }
}
.rail-monogram {
  font-size: 11px;
  font-weight: 700;
}
.rail-agent-badge {
  position: absolute;
  top: -3px;
  left: -3px;
  width: 8px;
  height: 8px;
  border: 1px solid var(--bg-raised);
  border-radius: 2px;
  background: var(--claude-mark, var(--ink-2));
}
.rail-attention {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border: 1px solid var(--bg-raised);
  border-radius: 999px;
  background: var(--danger);
}
</style>
