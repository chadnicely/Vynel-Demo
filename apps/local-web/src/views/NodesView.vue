<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useDashboardOverview } from "../composables/dashboard/use-dashboard-overview.js";
import { useFleetNodes } from "../composables/nodes/use-fleet-nodes.js";
import { useProjectNodes } from "../composables/nodes/use-project-nodes.js";
import { useMessageEdges } from "../composables/nodes/use-message-edges.js";
import {
  activeNodeLevel,
  hasLevelFor,
  type NodeLevelRegistry,
  type NodeLevelStackEntry,
} from "../composables/nodes/node-level.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useUiStore } from "../stores/ui-store.js";
import NodesFleetBar from "../components/nodes/NodesFleetBar.vue";
import NodesGrid from "../components/nodes/NodesGrid.vue";
import NodesRace from "../components/nodes/NodesRace.vue";
import NodesInvitation from "../components/nodes/NodesInvitation.vue";
import {
  parseSceneNodeId,
  type SceneNodeRef,
} from "../utils/constellation-node-ref.js";
import {
  startConstellationScene,
  type SceneHandle,
  type SceneLayout,
} from "../utils/constellation-scene.js";

// The Nodes screen — the design prototype's constellation, running on the real
// fleet. The scene itself (starfield, nebula, bloom core, curved glowing
// strands, particles, satellites) is the prototype's canvas engine ported
// wholesale into utils/constellation-scene.ts; this view owns the canvas
// lifecycle and where the user is standing. Everything a level shows — its
// dots, its arcs, its core label, what a click means — comes from that level's
// own composable, and each reading is its own component.
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

// ── A STACK OF LEVELS, ONE SCREEN (Chad, 2026-08-11). The node menu never
// goes away: the top level is ALL the software running; clicking a project
// node descends into that ONE project — same bar, same three readings, but
// the dots are now its sessions and work. A session node is what opens the
// chat.
//
// It used to be one `drilledProjectId` boolean branching through six
// computeds, which is why the screen could not grow past two levels
// (2026-08-19 audit). A level now owns everything about itself; the stack
// says which one is on show.
//
// Always opens on the fleet. The prototype seeded this from the active tab so
// a project's own node link could land you inside it, but the title bar's
// `Nodes` is the only way in here and it leaves the workspace tab first — that
// entry point is future work, not a dropped feature.
const stack = ref<NodeLevelStackEntry[]>([]);

/** The workspace the stack is standing inside, or null out on the fleet. */
const insideWorkspaceId = computed(() => {
  const top = stack.value[stack.value.length - 1];
  return top?.ref.kind === "workspace" ? top.ref.id : null;
});
const insideWorkspaceName = computed(
  () =>
    fleetWorkspaces.value.find((room) => room.id === insideWorkspaceId.value)
      ?.name ?? null,
);

function descend(ref: SceneNodeRef, label: string) {
  if (!hasLevelFor(ref.kind, registry)) return;
  stack.value = [...stack.value, { ref, label }];
}

// The arcs — a line between two dots when they talk. ONE poll for the whole
// screen; each level matches the same wire edges against its own dots. Only
// ever asked for while the constellation is the reading on show; the other two
// draw no lines.
const edgesQuery = useMessageEdges(() => ui.nodesMode === "nodes");
const edges = computed(() => edgesQuery.data.value?.edges ?? []);

const fleetLevel = useFleetNodes({
  workspaces: fleetWorkspaces,
  workspacesAnswered: () => overviewQuery.data.value !== undefined,
  edges,
  onPick: descend,
});

const projectLevel = useProjectNodes({
  workspaceId: insideWorkspaceId,
  workspaceName: insideWorkspaceName,
  edges,
  // Inside a project every dot IS the room's work and the room's chat is where
  // you act on it — one meaning, whichever kind was clicked.
  onPick: () => openDrilledProject(),
});

// Which level a drilled-into KIND opens. A third level — a session's spawned
// children, agent runs and tasks — is one composable plus one line here.
const registry: NodeLevelRegistry = {
  root: fleetLevel,
  workspace: projectLevel,
};

const level = computed(() => activeNodeLevel(stack.value, registry));

/** What the current level draws — projects out here, sessions in there. */
const displayNodes = computed(() => level.value.nodes.value);
const sceneMessages = computed(() => level.value.messages.value);

/** The crumbs, outermost first. Empty out on the fleet. */
const trail = computed(() => stack.value.map((entry) => entry.label));

/** Nothing here, and we KNOW it — never the loading state wearing the same
 *  face. An empty claim made from data we do not have yet is exactly the
 *  recorded nodes bug, and the fleet half of the guard was never wired. */
const levelHasAnswered = computed(() => level.value.hasAnswered.value);
const isLevelEmpty = computed(
  () => levelHasAnswered.value && displayNodes.value.length === 0,
);
const isFleetEmpty = computed(
  () => stack.value.length === 0 && isLevelEmpty.value,
);
/** The project level with nothing to show yet — its own quiet invitation. */
const isProjectEmpty = computed(
  () => stack.value.length > 0 && isLevelEmpty.value,
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
  if (insideWorkspaceId.value !== null) openWorkspace(insideWorkspaceId.value);
}

// One click, one meaning PER LEVEL: out on the fleet a project node DESCENDS
// — the bar stays, the dots become that project's sessions. In there, a dot
// opens the room itself. The level says which; the id says what was clicked.
function onNodeClick(nodeId: string) {
  const ref = parseSceneNodeId(nodeId);
  if (ref === null) return;
  const label =
    displayNodes.value.find((node) => node.id === nodeId)?.name ?? "";
  level.value.onPick(ref, label);
}

// The centre orb wears the level's own name: out on the fleet everything
// orbits Vynel itself, and once you have stepped inside, the project.
const coreLabel = computed(() => level.value.coreLabel.value);

function mountScene() {
  if (scene || !stage.value) return;
  scene = startConstellationScene(
    stage.value,
    [...displayNodes.value],
    onNodeClick,
  );
  scene.setCoreLabel(coreLabel.value);
  scene.setMessages([...sceneMessages.value]);
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

watch(displayNodes, (next) => scene?.setNodes([...next]));
watch(sceneMessages, (next) => scene?.setMessages([...next]));
watch(coreLabel, (name) => scene?.setCoreLabel(name), { immediate: true });

onBeforeUnmount(() => {
  scene?.destroy();
  scene = null;
});
</script>

<template>
  <div class="nodes-screen">
    <!-- In full view the bar is the window's top row, so it drags the window
         (the title bar is gone). Bound, not constant: Tauri honours the
         attribute whenever it is in the DOM, and the normal view has a title
         bar to drag by already. The raw flag is the derived reading here —
         this screen only mounts while its mode is live. -->
    <NodesFleetBar
      :data-tauri-drag-region="ui.isFullView || undefined"
      :mode="ui.nodesMode"
      :trail="trail"
      :nodes="displayNodes"
      :has-answered="levelHasAnswered"
      @update:mode="ui.nodesMode = $event"
      @back="stack = stack.slice(0, -1)"
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
      :copy="`Ask for something in ${insideWorkspaceName ?? 'this project'}'s chat and its sessions take their places here as the work happens.`"
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
      <!-- Says only what the screen does. It promised "hover a node for
           details" and there is no tooltip — the hover grows the dot and
           nothing more. The detail a tooltip would show now rides every
           SceneNode; rendering it is Kafi's visual pass (D7). -->
      <p class="hint">click a node to open it</p>
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
