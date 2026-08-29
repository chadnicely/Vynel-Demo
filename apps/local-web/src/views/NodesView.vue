<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
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
import { useCustomizeStore } from "../stores/customize-store.js";
import { useDemoStore } from "../stores/demo-store.js";
import { GLOBAL_TAB_ID, useUiStore } from "../stores/ui-store.js";
import { demoFleetNodes } from "../demo/demo-fleet.js";
import { DisplayBackdrop, resolveDisplayColour } from "@vynel/ui";
import NodesFleetBar from "../components/nodes/NodesFleetBar.vue";
import NodesGrid from "../components/nodes/NodesGrid.vue";
import NodesRace from "../components/nodes/NodesRace.vue";
import NodesInvitation from "../components/nodes/NodesInvitation.vue";
import {
  parseSceneNodeId,
  type SceneNodeRef,
} from "../utils/constellation-node-ref.js";
import type {
  SceneAmbientColours,
  SceneNode,
  SceneStatusColours,
} from "../utils/constellation-scene.js";
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

// The COLOUR half of the Display's look, reused here. Only the colour — the
// shape axis is the Display's own presence and has no meaning on a screen
// that draws a constellation.
const nodesColour = computed(() => resolveDisplayColour(ui.displayColour));

/**
 * The ground's hues, taken from the WHOLE palette rather than one accent.
 *
 * A Display frame in Violet is carrying magenta, lavender, blue and white at
 * once — that spread is what makes it look lit. Handing the nebula a single
 * hue would give the node screen a flat purple wash and lose exactly the
 * quality being matched, so the four blobs draw from four different entries:
 * two mote tints and two ring tints, which between them cover the full range
 * the orb is painted from.
 *
 * Only the colours travel. The blobs keep the scene's own sizes, positions,
 * drift and alpha — this is the same sky in a different palette, not a
 * different sky.
 */
const themedAmbient = computed<SceneAmbientColours>(() => {
  const { motes, rings } = nodesColour.value.orb;
  return {
    blobs: [motes[1], rings[0], motes[2], rings[2]],
    star: motes[3],
    starAccent: motes[1],
  };
});

/**
 * The five statuses, taken straight off the ACTIVE palette — the same colours
 * the orb's particles are painted from.
 *
 * This is a SHOW, not a status board (Kafi, 2026-08-27). The semantic code —
 * red means broken, green means done — is deliberately not honoured here:
 * matching the previous screen is the point. Theme off restores the semantic
 * five exactly.
 *
 * SIX-DIGIT HEX, never rgba(). The scene composes its glows by appending
 * two-digit hex alpha pairs to whatever colour it is given (col + "aa",
 * col + hex(0x66)), and an rgba() string with a hex suffix is an invalid
 * colour — addColorStop THROWS on those, which killed the disc pass every
 * frame: trails everywhere, not one node on screen.
 */
const themedStatusColours = computed<SceneStatusColours>(() => {
  const { motes, rings } = nodesColour.value.orb;
  const hexOf = (body: string, scale = 1) =>
    "#" +
    body
      .split(",")
      .map((part) => {
        const channel = Math.max(
          0,
          Math.min(255, Math.round(Number(part) * scale)),
        );
        return channel.toString(16).padStart(2, "0");
      })
      .join("");
  return {
    building: hexOf(motes[0]),
    waiting: hexOf(motes[1]),
    done: hexOf(motes[2]),
    problem: hexOf(motes[3]),
    // Idle recedes: the third ring tint pulled toward black. A DARK solid —
    // alpha is not available in a colour the scene will suffix.
    idle: hexOf(rings[2], 0.45),
  };
});

const activity = useActivityStore();
const customize = useCustomizeStore();

const overviewQuery = useDashboardOverview(() =>
  activity.isTurnRunning ? 5000 : false,
);

// Every project Vynel looks after — one dot each. `buildSceneNodes` drops the
// archived ones, so the picture only ever shows rooms that can still work.
const fleetWorkspaces = computed(
  () => overviewQuery.data.value?.workspaces ?? [],
);

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

// The global surfaces live on the pinned Global tab: the centre's click out
// on the fleet opens the BRAIN's continuing chat, and the voice moon opens
// the Voice chat surface — its one door (the spoken thread lives behind its
// own wall; no sidebar, no list).
function openGlobalSurface(view: "chat" | "voice-chat") {
  ui.activateTab(GLOBAL_TAB_ID);
  ui.globalTab.shell.mainView = view;
  if (view === "chat") ui.globalTab.shell.target = "continuous";
  void router.push({ name: "chat" });
}

const fleetLevel = useFleetNodes({
  workspaces: fleetWorkspaces,
  workspacesAnswered: () => overviewQuery.data.value !== undefined,
  edges,
  // The dot wears the room's customized face — the sidebar tree's rule.
  imageOf: (workspaceId) =>
    customize.customizationFor(workspaceId).workspaceImage,
  // The voice moon opens its surface; a project node descends.
  onPick: (ref, label) => {
    if (ref.kind === "voice") {
      openGlobalSurface("voice-chat");
      return;
    }
    descend(ref, label);
  },
  onCorePick: () => openGlobalSurface("chat"),
});

const projectLevel = useProjectNodes({
  workspaceId: insideWorkspaceId,
  workspaceName: insideWorkspaceName,
  edges,
  // Inside a project every dot IS the room's work and the room's chat is where
  // you act on it — one meaning, whichever kind was clicked. The centre (the
  // room's own primary) opens the same chat.
  onPick: () => openDrilledProject(),
  onCorePick: () => openDrilledProject(),
});

// Which level a drilled-into KIND opens. A third level — a session's spawned
// children, agent runs and tasks — is one composable plus one line here.
const registry: NodeLevelRegistry = {
  root: fleetLevel,
  workspace: projectLevel,
};

const level = computed(() => activeNodeLevel(stack.value, registry));

/** What the current level draws — projects out here, sessions in there. */
// A DEMO fleet — Chad's real product names (demo-fleet.ts), shown while the
// Demo switch below is on and there is nothing real to show. It exists so the
// screen can be LOOKED at before any projects exist. Nothing here reaches the
// server, and a real fleet always wins — EXCEPT while the filmed demo routine
// is driving: on camera the scripted fleet IS the show, whatever the real one
// is doing (demo-store, Chad 2026-08-28). The routine only ever plays the
// fleet level, so a drilled stack still shows its own dots.
const demo = useDemoStore();
const isRoutineDriving = computed(
  () => demo.routineNodes !== null && stack.value.length === 0,
);

const realNodes = computed(() => level.value.nodes.value);
const displayNodes = computed<SceneNode[]>(() => {
  if (isRoutineDriving.value) return [...demo.routineNodes!];
  return ui.nodesDemo && realNodes.value.length === 0
    ? demoFleetNodes(demo.projects)
    : [...realNodes.value];
});
const sceneMessages = computed(() =>
  isRoutineDriving.value ? demo.routineMessages : level.value.messages.value,
);

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

// The centre orb wears the level's own name AND its primary's status: out on
// the fleet everything orbits the global primary (Vynel itself); inside, the
// room's own thread — clicking it opens that conversation.
const coreLabel = computed(() => level.value.coreLabel.value);
const coreStatus = computed(() => level.value.coreStatus.value);

function mountScene() {
  if (scene || !stage.value) return;
  scene = startConstellationScene(
    stage.value,
    [...displayNodes.value],
    onNodeClick,
    () => level.value.onCorePick(),
  );
  scene.setStatusColours(ui.nodesThemed ? themedStatusColours.value : null);
  scene.setAmbientColours(ui.nodesThemed ? themedAmbient.value : null);
  scene.setCoreLabel(coreLabel.value);
  scene.setCoreStatus(coreStatus.value);
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
// Live, so the Theme switch swaps grounds without remounting the scene.
watch(
  [() => ui.nodesThemed, themedAmbient],
  ([themed, colours]) => scene?.setAmbientColours(themed ? colours : null),
  { immediate: true },
);
// The switch AND a colour change both repaint the fleet.
watch(
  [() => ui.nodesThemed, themedStatusColours],
  ([themed, colours]) => scene?.setStatusColours(themed ? colours : null),
  { immediate: true },
);
watch(sceneMessages, (next) => scene?.setMessages([...next]));
watch(coreLabel, (name) => scene?.setCoreLabel(name), { immediate: true });
watch(coreStatus, (status) => scene?.setCoreStatus(status), {
  immediate: true,
});

onBeforeUnmount(() => {
  scene?.destroy();
  scene = null;
});
</script>

<template>
  <!-- THE SHOW (Kafi, 2026-08-27): with Theme on, this screen IS the Display
       in constellation form. Same ground (the tinted black + the moving
       backdrop below), same palette on the nebula and the star field, and the
       node dots wear the orb's own particle tints — the status code is
       deliberately NOT honoured while themed, because matching the previous
       screen is the point. Theme off restores the semantic room exactly:
       original ground, original violets, purple/orange/red/green/grey dots. -->
  <div
    class="nodes-screen"
    :class="{ 'display-palette': ui.nodesThemed }"
    :data-display-colour="ui.nodesThemed ? nodesColour.id : undefined"
  >
    <!-- The same moving room the Display stands in. First child, so every
         positioned sibling paints above it. The scene's own recoloured
         nebula drifts OVER this at low alpha — the two are one palette now,
         so they layer instead of fighting. -->
    <DisplayBackdrop
      v-if="ui.nodesThemed"
      :key="nodesColour.id"
      class="nodes-backdrop"
    />
    <!-- The Nodes screen is always a FULL view: this bar is the window's top
         row, so it drags the window (the title bar is gone). -->
    <NodesFleetBar
      data-tauri-drag-region
      :mode="ui.nodesMode"
      :trail="trail"
      :nodes="displayNodes"
      :has-answered="levelHasAnswered"
      @update:mode="ui.nodesMode = $event"
      @back="stack = stack.slice(0, -1)"
      @open-chat="openDrilledProject"
    />

    <div v-show="ui.nodesMode === 'nodes'" ref="stage" class="stage" />

    <!-- Always reachable, fleet or no fleet. Theme decides whether this screen
         borrows the Display's colour; Demo puts a fabricated fleet up so the
         screen can be looked at before any projects exist. Neither touches the
         node STATUS colours, and a real fleet always beats the demo. -->
    <nav
      v-if="ui.nodesMode === 'nodes'"
      class="view-switches"
      aria-label="View"
    >
      <button
        type="button"
        class="layout-btn"
        :class="{ on: ui.nodesThemed }"
        :aria-pressed="ui.nodesThemed"
        data-testid="nodes-theme-toggle"
        @click="ui.toggleNodesThemed()"
      >
        Theme
      </button>
      <button
        type="button"
        class="layout-btn"
        :class="{ on: ui.nodesDemo }"
        :aria-pressed="ui.nodesDemo"
        data-testid="nodes-demo-toggle"
        @click="ui.toggleNodesDemo()"
      >
        Demo
      </button>
    </nav>

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

/* Behind the constellation and every control.
 *
 * NO blanket rule on the siblings. There was one — `position: relative` on
 * every child but this — and it outranked `.stage`'s own `position: absolute`,
 * which killed its `inset: 0` and collapsed it to ZERO height: the canvases
 * came out 1600×1 and the constellation had nowhere to draw. Nothing needed
 * it: the backdrop is the FIRST child, and positioned siblings later in the
 * document already paint above it. */
.nodes-backdrop {
  z-index: 0;
}

/* The ROOM's ground, verbatim from display-root.css. The backdrop paints the
 * moving layers but the base — the tinted black the Display stands on — lives
 * on .display-root, which this screen is not. Without this the backdrop sat
 * on the app shell's flat grey and the two screens could never match. The
 * variables all arrive via [data-display-colour] on this same element. */
.nodes-screen.display-palette {
  background:
    radial-gradient(
      ellipse at 50% 45%,
      var(--display-bloom-inner, rgba(30, 120, 210, 0.62)),
      transparent 66%
    ),
    radial-gradient(
      ellipse at 50% 45%,
      var(--display-bloom-outer, rgba(20, 80, 170, 0.35)),
      transparent 80%
    ),
    linear-gradient(
      180deg,
      var(--display-ground-top, #02132b),
      var(--display-ground-bottom, #010a1c)
    );
}

/* The scene's three canvases are absolutely positioned inside this. */
.stage {
  position: absolute;
  inset: 0;
}

/* Top-right, clear of the layout picker at the bottom and of the fleet bar. */
.view-switches {
  position: absolute;
  top: 58px;
  right: 18px;
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(35, 37, 50, 0.72);
  border: 1px solid var(--hair);
  backdrop-filter: blur(6px);
  z-index: 2;
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
