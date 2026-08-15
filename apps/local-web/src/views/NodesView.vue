<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useDashboardOverview } from "../composables/dashboard/use-dashboard-overview.js";
import { useFleetNodes } from "../composables/nodes/use-fleet-nodes.js";
import { useProjectNodes } from "../composables/nodes/use-project-nodes.js";
import { useMessageEdges } from "../composables/nodes/use-message-edges.js";
import {
  fleetMessages,
  projectMessages,
} from "../composables/nodes/message-scene-mapping.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useUiStore } from "../stores/ui-store.js";
import NodesFleetBar from "../components/nodes/NodesFleetBar.vue";
import NodesGrid from "../components/nodes/NodesGrid.vue";
import NodesRace from "../components/nodes/NodesRace.vue";
import NodesInvitation from "../components/nodes/NodesInvitation.vue";
import {
  startConstellationScene,
  type SceneHandle,
  type SceneLayout,
  type SceneMessage,
} from "../utils/constellation-scene.js";

// The Nodes screen — the design prototype's constellation, running on the real
// fleet. The scene itself (starfield, nebula, bloom core, curved glowing
// strands, particles, satellites) is the prototype's canvas engine ported
// wholesale into utils/constellation-scene.ts; this view owns the canvas
// lifecycle and which level is on show. The dots' data lives in the two
// `composables/nodes` composables, and each reading is its own component.
//
// The canvas runs whether or not there are workspaces: with none, you still
// get the starfield and the core awake at the centre, and the invitation
// overlays it. An empty stage read as broken; a lit one reads as new.
const router = useRouter();
const ui = useUiStore();
const activity = useActivityStore();

const overviewQuery = useDashboardOverview(() =>
  activity.isTurnRunning ? 5000 : false,
);

// Every project Vynel looks after — one dot each. `buildSceneNodes` drops the
// archived ones, so the picture only ever shows rooms that can still work.
const fleetWorkspaces = computed(() => overviewQuery.data.value?.workspaces ?? []);
const fleetNodes = useFleetNodes(fleetWorkspaces);

// ── TWO LEVELS, ONE SCREEN (Chad, 2026-08-11). The node menu never goes
// away: the top level is ALL the software running; clicking a project node
// descends into that ONE project — same bar, same three readings, but the
// dots are now its sessions and work. A session node is what opens the chat.
//
// Always opens on the fleet. The prototype seeded this from the active tab so
// a project's own node link could land you inside it, but the title bar's
// `Nodes` is the only way in here and it leaves the workspace tab first — that
// entry point is future work, not a dropped feature.
const drilledProjectId = ref<string | null>(null);
const drilledProject = computed(
  () =>
    fleetWorkspaces.value.find((room) => room.id === drilledProjectId.value) ??
    null,
);
const isInsideProject = computed(() => drilledProjectId.value !== null);
const projectNodes = useProjectNodes(drilledProjectId);

/** What the current level draws — projects out here, sessions in there. */
const displayNodes = computed(() =>
  isInsideProject.value ? projectNodes.nodes.value : fleetNodes.value,
);

// The arcs — a line between two dots when they talk. Only ever asked for while
// the constellation is the reading on show; the other two draw no lines.
const edgesQuery = useMessageEdges(() => ui.nodesMode === "nodes");

/** What the CURRENT level can draw a line between. Each level speaks its own
 *  id shape, so the same wire edge maps differently in here than out there. */
const sceneMessages = computed<SceneMessage[]>(() => {
  const edges = edgesQuery.data.value?.edges ?? [];
  if (edges.length === 0) return [];
  if (!isInsideProject.value) {
    return fleetMessages(
      edges,
      new Set(fleetNodes.value.map((node) => node.id)),
    );
  }
  return projectMessages(edges, {
    projectId: drilledProjectId.value!,
    continuingSessionId: projectNodes.continuingSessionId.value,
    drawnSessionIds: new Set(
      projectNodes.nodes.value
        .filter((node) => node.id.startsWith("session:"))
        .map((node) => node.id.slice("session:".length)),
    ),
  });
});

const isFleetEmpty = computed(
  () =>
    !isInsideProject.value &&
    overviewQuery.data.value !== undefined &&
    fleetNodes.value.length === 0,
);

/** The project level with nothing to show yet — its own quiet invitation. */
const isProjectEmpty = computed(
  () =>
    isInsideProject.value &&
    projectNodes.hasAnswered.value &&
    projectNodes.nodes.value.length === 0,
);

const stage = ref<HTMLElement | null>(null);
let scene: SceneHandle | null = null;

// The prototype's three arrangements of the same fleet.
const LAYOUTS: Array<{ id: SceneLayout; label: string }> = [
  { id: "constellation", label: "Constellation" },
  { id: "orbit", label: "Orbit" },
  { id: "rise", label: "Rise" },
];
const layout = ref<SceneLayout>("constellation");
function setLayout(next: SceneLayout) {
  layout.value = next;
  scene?.setLayout(next);
}

function openWorkspace(workspaceId: string) {
  ui.openWorkspaceTab(workspaceId);
  void router.push({ name: "workspace" });
}

function openDrilledProject() {
  if (drilledProjectId.value !== null) openWorkspace(drilledProjectId.value);
}

// One click, two meanings: out on the fleet a project node DESCENDS — the
// bar stays, the dots become that project's sessions. In there, a session
// node opens the room itself.
function onNodeClick(nodeId: string) {
  if (!isInsideProject.value) {
    drilledProjectId.value = nodeId;
    return;
  }
  openDrilledProject();
}

// The centre orb wears the level's own name: out on the fleet everything
// orbits Vynel itself, and once you have stepped inside, the project.
const coreLabel = computed(() =>
  isInsideProject.value ? (drilledProject.value?.name ?? "Project") : "Vynel",
);

function mountScene() {
  if (scene || !stage.value) return;
  scene = startConstellationScene(stage.value, displayNodes.value, onNodeClick);
  scene.setCoreLabel(coreLabel.value);
  scene.setMessages(sceneMessages.value);
  scene.setLayout(layout.value);
}

// Only if Nodes is the reading on show — `ui.nodesMode` outlives the route, so
// arriving back on Grid or Race must not start a frame loop behind `v-show`'s
// display:none.
onMounted(() => {
  if (ui.nodesMode === "nodes") mountScene();
});

// The canvas only exists while Nodes is showing; leaving stops its frame loop
// rather than animating a fleet nobody can see.
watch(
  () => ui.nodesMode,
  async (next) => {
    if (next === "nodes") {
      await nextTick();
      mountScene();
      return;
    }
    scene?.destroy();
    scene = null;
  },
);

watch(displayNodes, (next) => scene?.setNodes(next));
watch(sceneMessages, (next) => scene?.setMessages(next));
watch(coreLabel, (name) => scene?.setCoreLabel(name), { immediate: true });

onBeforeUnmount(() => {
  scene?.destroy();
  scene = null;
});
</script>

<template>
  <div class="nodes-screen">
    <NodesFleetBar
      :mode="ui.nodesMode"
      :drilled-project-name="isInsideProject ? (drilledProject?.name ?? '') : null"
      :nodes="displayNodes"
      @update:mode="ui.nodesMode = $event"
      @back="drilledProjectId = null"
      @open-chat="openDrilledProject"
    />

    <div v-show="ui.nodesMode === 'nodes'" ref="stage" class="stage" />

    <NodesGrid
      v-if="ui.nodesMode === 'grid'"
      :nodes="displayNodes"
      @open="onNodeClick"
    />

    <NodesRace v-if="ui.nodesMode === 'race'" :nodes="displayNodes" />

    <!-- The project level with no work yet — honest, and a door to the one
         place work actually starts. -->
    <NodesInvitation
      v-if="isProjectEmpty"
      title="Nothing running in here yet"
      :copy="`Ask for something in ${drilledProject?.name ?? 'this project'}'s chat and its sessions take their places here as the work happens.`"
      cta="Open the chat"
      @act="openDrilledProject"
    />

    <NodesInvitation
      v-if="isFleetEmpty"
      title="Nothing in orbit yet"
      copy="Vynel is awake and listening. Add a workspace and it takes its place here — one node for each thing it looks after, so you can see everything at once."
      cta="Add your first workspace"
      shows-plus
      @act="ui.requestCreateWorkspace()"
    />

    <template v-else-if="ui.nodesMode === 'nodes'">
      <nav class="layouts" aria-label="Constellation layout">
        <button
          v-for="option in LAYOUTS"
          :key="option.id"
          type="button"
          class="layout-btn"
          :class="{ on: option.id === layout }"
          :aria-pressed="option.id === layout"
          @click="setLayout(option.id)"
        >
          {{ option.label }}
        </button>
      </nav>
      <p class="hint">hover a node for details · click to open it</p>
    </template>
  </div>
</template>

<style scoped>
.nodes-screen {
  position: relative;
  height: 100%;
  overflow: hidden;
}

/* The scene's three canvases are absolutely positioned inside this. */
.stage {
  position: absolute;
  inset: 0;
}

.layouts {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(35, 37, 50, 0.72);
  border: 1px solid var(--hair);
  backdrop-filter: blur(6px);
}
.layout-btn {
  appearance: none;
  padding: 5px 13px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font: 500 11.5px var(--font-ui);
  cursor: pointer;
}
.layout-btn:hover {
  color: var(--ink-1);
}
.layout-btn.on {
  border-color: var(--gold);
  background: var(--gold-soft);
  color: var(--ink-1);
}

.hint {
  position: absolute;
  bottom: 18px;
  left: 0;
  right: 0;
  margin: 0;
  text-align: center;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  pointer-events: none;
}
</style>
