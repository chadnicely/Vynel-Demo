// The Mission Control scene, ported from the design prototype's canvas engine
// (prototype/mission-control/js/monitor.js — the `Graph` module + `starfield`).
//
// Kept as plain TypeScript rather than Vue: it is a requestAnimationFrame loop
// over two canvases, and framework reactivity has no part in a 60fps draw. The
// view owns the DOM and the data; this owns every pixel.
//
// It also stays ONE file past the house size rule on purpose. Everything below
// is a single frame loop sharing one set of mutable buffers (positions, stars,
// particles, orbiters) that are read and written every tick; splitting it would
// mean exporting that state across module seams for no gain in legibility, and
// the seams it does have — the data mapping and the layout arithmetic — live
// in constellation-layout.ts where they can be tested without a canvas.
//
// The look is Nocturne's, not the token bridge's — the prototype's exact
// violets, because these are literal canvas paint values (gradients, glow
// colors, alpha ramps) rather than themeable surfaces.

import {
  constellationSlots,
  inheritedSlots,
  orbitLaneCount,
  orbitLaneIndex,
  riseStep,
} from "./constellation-layout.js";

/** What a dot would say if you asked it. The derivations already produce all
 *  of this and used to discard it at the `resolveNodeStatus(...)` call sites;
 *  it now rides the node so a later pass can render it. NOTHING draws it
 *  today — D7 defers the visual (Kafi, 2026-08-19). */
export interface SceneNodeDetail {
  /** The status ladder's own note — a set-state's reason, or an error. */
  note?: string | null;
  tasksDone?: number;
  tasksTotal?: number;
  /** Ms since the live turn started, when one is running. */
  elapsedMs?: number;
  /** How many spawned sessions / agent runs / tasks hang off this one. */
  childCount?: number;
}

export interface SceneNode {
  /** `<kind>:<id>` — minted and parsed in constellation-node-ref.ts, never
   *  by hand. The scene treats it as opaque and only ever compares it. */
  id: string;
  name: string;
  initials: string;
  /** Drives colour, glow and the orbiters — the five fleet states. */
  status: "building" | "waiting" | "problem" | "done" | "idle";
  /** `"moon"` = a close satellite of the CORE (the voice thread — "like moon
   *  for earth", Kafi 2026-08-24): it rides a tight first orbit in every
   *  layout and draws smaller, instead of taking a ring slot. */
  role?: "moon";
  /** The node's own face — a customized workspace image (data URL). Drawn
   *  clipped inside the disc once loaded; the initials until then / without. */
  imageUrl?: string | null;
  detail?: SceneNodeDetail;
}

// ONE state, ONE colour WITHIN this screen (Chad, 2026-08-12): working (a live
// turn, or a queue running a task) is PURPLE, completed is green, waiting on
// YOU is orange, a problem is red, idle is grey. The palette is scene-local —
// main's other surfaces render `WorkspaceEffectiveStatus`, which
// `resolveNodeStatus` renames into these five (Kafi's one-rule pass,
// 2026-08-17, is what finally gave `problem` a feeder).
const COL: Record<SceneNode["status"], string> = {
  building: "#b5abfc",
  waiting: "#ff9a3d",
  problem: "#ef4444",
  done: "#4ade80",
  idle: "#75798c",
};
const DIM = "#9397ab";

/** The five status colours ACTUALLY in use. Defaults to `COL` — the semantic
 *  set above — and can be swapped wholesale for a themed one so the fleet
 *  matches the Display on camera. The mapping is the caller's (it owns the
 *  palette); this only holds whatever it was handed. */
export type SceneStatusColours = Record<SceneNode["status"], string>;

/** The ground's hues: one `r,g,b` body per nebula blob, plus the two star
 *  tints. Only colour — the scene keeps its own shapes and motion. */
export interface SceneAmbientColours {
  blobs: readonly string[];
  star: string;
  starAccent: string;
}

// A message arc is its own mark, deliberately NOT one of the node colours: it
// is an event between two dots, not the state of either. Fuchsia going out,
// green coming home — the pair reads as question and answer at a glance.
const MESSAGE_COL: Record<SceneMessage["direction"], string> = {
  ask: "#e879f9",
  reply: "#4ade80",
};
/** How long the head takes to travel the whole arc. */
const MESSAGE_TRAVEL_MS = 1400;
/** How long the arc lingers afterwards before it is gone. */
const MESSAGE_LIFETIME_MS = 60_000;

const isLive = (node: SceneNode) =>
  node.status === "building" ||
  node.status === "waiting" ||
  node.status === "problem";

interface Star {
  x: number;
  y: number;
  r: number;
  v: number;
  tw: number;
  accent: boolean;
}
interface Particle {
  /** The NODE it travels to, not its slot: the list re-sorts under us. */
  nodeId: string;
  t: number;
  dir: number;
  speed: number;
  off: number;
  col: string;
  size: number;
}
interface Orbiter {
  ang: number;
  r: number;
  speed: number;
}

/** Huge soft colour fields drifting behind everything — the aurora that makes
 *  the ground feel like space rather than a dark rectangle. */
const BLOBS = [
  { hx: 0.2, hy: 0.28, r: 0.52, col: "145,132,217", a: 0.055, sp: 1.0, ph: 0 },
  { hx: 0.78, hy: 0.64, r: 0.58, col: "76,83,151", a: 0.08, sp: 0.7, ph: 2.1 },
  { hx: 0.52, hy: 0.12, r: 0.44, col: "53,59,128", a: 0.07, sp: 0.5, ph: 4.2 },
  { hx: 0.34, hy: 0.85, r: 0.48, col: "93,82,148", a: 0.05, sp: 0.85, ph: 5.6 },
];

/** How the fleet arranges itself. Constellation is the ring everyone knows;
 *  Orbit gives each node its own lane around the core; Rise stacks them by
 *  how far along they are. The prototype's three layout buttons. */
export type SceneLayout = "constellation" | "orbit" | "rise";

/** One message that travelled between two dots. `null` at either end means the
 *  core — the global root really is the centre of this picture, so a message to
 *  or from it needs no special case. */
export interface SceneMessage {
  /** Stable across polls, so a message already in flight is never restarted. */
  id: string;
  fromId: string | null;
  toId: string | null;
  /** `ask` = work handed down; `reply` = a result carried back. */
  direction: "ask" | "reply";
  /** Epoch ms. Older than MESSAGE_LIFETIME_MS and it is simply not drawn. */
  sentAt: number;
}

export interface SceneHandle {
  setNodes(nodes: SceneNode[]): void;
  setMessages(messages: SceneMessage[]): void;
  setLayout(layout: SceneLayout): void;
  /** The centre carries the WORKSPACE's name — "NICELY MEDIA", not a brand. */
  setCoreLabel(label: string): void;
  /** The centre IS a conversation now (the global primary out on the fleet,
   *  the room's own thread inside one — Kafi 2026-08-24), so it wears the
   *  same five states a dot does: ring, glow and dash-spin say "working". */
  setCoreStatus(status: SceneNode["status"]): void;
  /** Index under the pointer, or -1 — the view drives its own tooltip. */
  hitTest(clientX: number, clientY: number): number;
  /** Recolour the drifting nebula and the starfield. `null` restores the
   *  scene's own violets. The SHAPE of the ground never changes — only its
   *  hue — so the screen keeps its character and merely wears the Display's
   *  palette. */
  setAmbientColours(colours: SceneAmbientColours | null): void;
  /** Repaint the five statuses from a themed palette, or `null` to go back to
   *  the semantic set. Shown-only: nothing about what a status MEANS changes. */
  setStatusColours(colours: SceneStatusColours | null): void;
  destroy(): void;
}

export function startConstellationScene(
  host: HTMLElement,
  initialNodes: SceneNode[],
  onPick: (id: string) => void,
  /** The centre's click — the primary conversation it stands for. Absent =
   *  the core is furniture, as before. */
  onCorePick?: () => void,
): SceneHandle {
  let ambientCol: SceneAmbientColours | null = null;
  // Live lookup, so a theme change repaints without rebuilding the scene.
  let statusCol: SceneStatusColours = { ...COL };
  const bgCv = document.createElement("canvas"); // starfield + nebula
  const fxCv = document.createElement("canvas"); // additive trails
  const ndCv = document.createElement("canvas"); // crisp nodes + edges
  for (const cv of [bgCv, fxCv, ndCv]) {
    cv.style.cssText = "position:absolute;inset:0;";
    host.append(cv);
  }
  const bgMaybe = bgCv.getContext("2d");
  const fxMaybe = fxCv.getContext("2d");
  const ndMaybe = ndCv.getContext("2d");

  // No 2D context — jsdom under test, or a browser refusing one. The view's
  // chrome (the invitation, the hint) still has to work, so hand back a
  // handle that does nothing rather than taking the whole page down.
  if (!bgMaybe || !fxMaybe || !ndMaybe) {
    for (const cv of [bgCv, fxCv, ndCv]) cv.remove();
    return {
      setAmbientColours() {},
      setStatusColours() {},
      setNodes() {},
      setMessages() {},
      setLayout() {},
      setCoreLabel() {},
      setCoreStatus() {},
      hitTest: () => -1,
      destroy() {},
    };
  }
  // Re-bound as non-null so every closure below sees a real context.
  const bg = bgMaybe;
  const fx = fxMaybe;
  const nd = ndMaybe;

  let nodes = initialNodes;
  let coreLabel = "VYNEL";
  let coreStatus: SceneNode["status"] = "idle";
  // The node faces — one Image per url, started on first sight, drawn from
  // the frame it finishes. A failed load stays in the map as "tried" so the
  // loop never re-fetches a broken data URL sixty times a second.
  const nodeImages = new Map<string, HTMLImageElement>();
  function imageFor(url: string): HTMLImageElement | null {
    let image = nodeImages.get(url);
    if (image === undefined) {
      image = new Image();
      image.src = url;
      nodeImages.set(url, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }
  let W = 0;
  let H = 0;
  let dpr = 1;
  let stars: Star[] = [];
  let raf = 0;
  let last = 0;
  let introT = 0;
  let hoverIndex = -1;
  let layoutMode: SceneLayout = "constellation";
  // Slot-aligned scratch, RECONCILED BY NODE ID on every `setNodes` (see
  // there). The frame loop still walks slots — it draws thousands of times a
  // second — but which slot a node holds is decided once per update.
  const positions: Array<{ x: number; y: number }> = [];
  const core = { x: 0, y: 0 };
  const particles: Particle[] = [];
  let messages: SceneMessage[] = [];
  let spawnAcc: number[] = [];
  let orbiters: Orbiter[][] = [];
  /** id → slot, rebuilt once per `setNodes`. Every per-frame lookup (message
   *  anchors, particle hosts) reads this instead of scanning the array —
   *  `anchorOf` used to `findIndex` twice per message per frame at 60fps
   *  (2026-08-19 audit, agent-4 §5a). */
  let slotById = new Map<string, number>();
  /** Each slot's index among the RING nodes (-1 for a moon), so the three
   *  arrangements place only the ring and never leave a gap where a moon's
   *  consumed slot would have been. Rebuilt with `slotById`. */
  let ringIndexBySlot: number[] = [];
  let ringCount = 0;

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, x), 3);

  const freshOrbiters = (): Orbiter[] =>
    Array.from({ length: 3 }, (_, k) => ({
      ang: Math.random() * Math.PI * 2,
      r: 34 + k * 6,
      speed: 2.2 + Math.random() * 1.8,
    }));

  function indexNodes() {
    slotById = new Map(nodes.map((node, i) => [node.id, i]));
    ringCount = 0;
    ringIndexBySlot = nodes.map((node) =>
      node.role === "moon" ? -1 : ringCount++,
    );
  }
  spawnAcc = nodes.map(() => 0);
  orbiters = nodes.map(freshOrbiters);
  indexNodes();

  function resize() {
    dpr = devicePixelRatio || 1;
    W = host.clientWidth;
    H = host.clientHeight;
    for (const cv of [bgCv, fxCv, ndCv]) {
      cv.width = Math.max(1, W * dpr);
      cv.height = Math.max(1, H * dpr);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
    }
    for (const ctx of [bg, fx, nd]) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: 110 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.4 + Math.random() * 1.3,
      v: 0.02 + Math.random() * 0.08,
      tw: Math.random() * Math.PI * 2,
      accent: Math.random() < 0.22,
    }));
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  /** Every node eases toward its target, so switching layout MORPHS rather
   *  than cuts — the prototype's one trick that makes the three modes feel
   *  like the same fleet rearranging itself. */
  function layout(t: number, dt: number) {
    const k = ease(introT);
    let target: { x: number; y: number };
    const wanted: Array<{ x: number; y: number }> = [];

    if (layoutMode === "orbit") {
      target = { x: W / 2, y: H / 2 + 6 };
      nodes.forEach((node, i) => {
        if (node.role === "moon") return;
        const ri = ringIndexBySlot[i]!;
        const lane = orbitLane(orbitLaneIndex(ri));
        // Anything working laps the core faster — motion IS the status here.
        const ang =
          ri * 2.39996 +
          t * 0.00005 * (1.7 - ri * 0.13) * (isLive(node) ? 2.1 : 0.7);
        wanted[i] = {
          x: target.x + Math.cos(ang) * lane * k,
          y: target.y + Math.sin(ang) * lane * 0.82 * k,
        };
      });
    } else if (layoutMode === "rise") {
      // The floor clears the layout pill + hint at the bottom of the stage
      // (Chad, 2026-08-11: nodes were sitting on the selectors).
      target = { x: W / 2, y: H - 200 };
      const { y0, y1 } = riseBand();
      const step = riseStep(ringCount, W);
      nodes.forEach((node, i) => {
        if (node.role === "moon") return;
        const ri = ringIndexBySlot[i]!;
        const x = Math.min(
          W - 80,
          Math.max(80, W * 0.5 + (ri - (ringCount - 1) / 2) * step),
        );
        // Height = how far along it is. Nothing reports progress yet, so a
        // working node floats mid-band and everything else sits on the floor.
        const frac = isLive(node) ? 0.5 : 0;
        wanted[i] = {
          x: x + Math.sin(t / 1700 + ri * 2.1) * 6,
          y: y0 - (y0 - y1) * frac * k + Math.cos(t / 1400 + ri * 1.3) * 5,
        };
      });
    } else {
      target = { x: W / 2, y: H / 2 + 6 };
      const rx = Math.max(180, Math.min(W * 0.37, 520)) * k;
      const ry = Math.max(130, Math.min(H * 0.36, 300)) * k;
      const slots = constellationSlots(ringCount);
      nodes.forEach((node, i) => {
        if (node.role === "moon") return;
        const ri = ringIndexBySlot[i]!;
        const slot = slots[ri]!;
        wanted[i] = {
          x:
            target.x +
            Math.cos(slot.angle) * rx * slot.radiusScale +
            Math.sin(t / 1700 + ri * 2.1) * 7,
          y:
            target.y +
            Math.sin(slot.angle) * ry * slot.radiusScale +
            Math.cos(t / 1400 + ri * 1.3) * 6,
        };
      });
    }

    // Moons ignore the arrangement: whatever the fleet is doing, a moon rides
    // its own tight first orbit around the core — the one relation all three
    // layouts share ("like moon for earth", Kafi 2026-08-24).
    nodes.forEach((node, i) => {
      if (node.role !== "moon") return;
      const ang = t * 0.00022 + i * 2.1;
      const lane = 96 * k;
      wanted[i] = {
        x: target.x + Math.cos(ang) * lane,
        y: target.y + Math.sin(ang) * lane * 0.82,
      };
    });

    if (core.x === 0 && core.y === 0) {
      core.x = target.x;
      core.y = target.y;
    }
    const s = 1 - Math.exp(-dt * 5);
    core.x += (target.x - core.x) * s;
    core.y += (target.y - core.y) * s;
    nodes.forEach((_, i) => {
      const p = positions[i];
      if (!p) {
        positions[i] = { x: wanted[i]!.x, y: wanted[i]!.y };
        return;
      }
      p.x += (wanted[i]!.x - p.x) * s;
      p.y += (wanted[i]!.y - p.y) * s;
    });
    positions.length = nodes.length;
  }

  /** Rise's band — floor and ceiling, ONE home shared by the nodes and the
   *  altitude scale so they can never disagree. The floor sits well above
   *  the layout pill + hint (Chad, 2026-08-11: "RISE NEEDS TO BE HIGHER"). */
  function riseBand() {
    return { y0: H - 280, y1: 110 };
  }

  /** One orbit lane's radius. ONE home shared by the nodes and the guide
   *  ellipses — the two used to compute it separately and could only agree by
   *  coincidence. */
  function orbitLane(laneIndex: number) {
    return Math.min(W * 0.46, H * 0.47) * (0.3 + 0.115 * laneIndex);
  }

  /** Guide furniture the layout needs to be readable: orbit lanes, or the
   *  altitude scale Rise measures against. */
  function drawLayoutFurniture() {
    if (layoutMode === "orbit") {
      // ONE ellipse per LANE, not per node: past the lane cap several nodes
      // share a lane, and stroking it once each would quietly darken it.
      // A lane is lit when anything on it is working.
      for (
        let laneIndex = 0;
        laneIndex < orbitLaneCount(ringCount);
        laneIndex += 1
      ) {
        const lane = orbitLane(laneIndex);
        const lit = nodes.some(
          (node, i) =>
            node.role !== "moon" &&
            orbitLaneIndex(ringIndexBySlot[i]!) === laneIndex &&
            isLive(node),
        );
        nd.beginPath();
        nd.ellipse(core.x, core.y, lane, lane * 0.82, 0, 0, Math.PI * 2);
        nd.strokeStyle = lit
          ? "rgba(145,132,217,0.13)"
          : "rgba(145,132,217,0.06)";
        nd.lineWidth = 1;
        nd.stroke();
      }
    } else if (layoutMode === "rise") {
      const { y0, y1 } = riseBand();
      nd.textBaseline = "middle";
      for (const f of [0.25, 0.5, 0.75, 1]) {
        const y = y0 - (y0 - y1) * f;
        nd.setLineDash([3, 9]);
        nd.beginPath();
        nd.moveTo(64, y);
        nd.lineTo(W - 64, y);
        nd.strokeStyle =
          f === 1 ? "rgba(74,222,128,0.16)" : "rgba(145,132,217,0.10)";
        nd.lineWidth = 1;
        nd.stroke();
        nd.setLineDash([]);
        nd.fillStyle =
          f === 1 ? "rgba(74,222,128,0.55)" : "rgba(147,151,171,0.45)";
        nd.font = '700 8.5px "Segoe UI Variable Text", system-ui, sans-serif';
        nd.textAlign = "left";
        nd.fillText(f === 1 ? "DONE" : `${Math.round(f * 100)}%`, 34, y);
        nd.textAlign = "center";
      }
    }
  }

  /** Where a message endpoint sits. A dot this level does not draw — the global
   *  root, or a room off-screen at the other level — resolves to the core,
   *  which is what it visually IS here. */
  function anchorOf(id: string | null) {
    if (id === null) return core;
    const slot = slotById.get(id);
    return (slot === undefined ? undefined : positions[slot]) ?? core;
  }

  /** Which way an arc bows, stable per message, so two between the same pair
   *  never lie on top of each other. */
  function bendOf(id: string) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1)
      hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return (hash % 2 === 0 ? 1 : -1) * (0.55 + (Math.abs(hash) % 5) * 0.14);
  }

  /** A bowed bezier between two arbitrary points — the same curve language the
   *  core strands speak, so an arc reads as part of this picture. */
  function messagePoint(
    a: { x: number; y: number },
    b: { x: number; y: number },
    bend: number,
    t: number,
  ) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = bend * Math.min(120, len * 0.28);
    const cx = (a.x + b.x) / 2 - (dy / len) * bow;
    const cy = (a.y + b.y) / 2 + (dx / len) * bow;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * cx + t * t * b.x,
      y: u * u * a.y + 2 * u * t * cy + t * t * b.y,
    };
  }

  /** The arcs. A head travels the curve first, drawing the line behind it, then
   *  the whole arc lingers and fades so you can still see what just happened
   *  after looking away. Drawn ABOVE the strands and BELOW the nodes — a dot is
   *  never hidden behind its own traffic. */
  function drawMessages(nowMs: number) {
    const SEGMENTS = 40;
    for (const message of messages) {
      const age = nowMs - message.sentAt;
      if (age < 0 || age > MESSAGE_LIFETIME_MS) continue;
      const from = anchorOf(message.fromId);
      const to = anchorOf(message.toId);
      // Both ends landed on the core: nothing this level can draw a line
      // between. Never a dot talking to itself.
      if (from === to) continue;

      const bend = bendOf(message.id);
      const col = MESSAGE_COL[message.direction];
      const travelled = reduceMotion
        ? 1
        : ease(Math.min(1, age / MESSAGE_TRAVEL_MS));
      const settled =
        Math.max(0, age - MESSAGE_TRAVEL_MS) /
        (MESSAGE_LIFETIME_MS - MESSAGE_TRAVEL_MS);

      nd.beginPath();
      for (let step = 0; step <= SEGMENTS; step += 1) {
        const point = messagePoint(
          from,
          to,
          bend,
          (step / SEGMENTS) * travelled,
        );
        if (step === 0) nd.moveTo(point.x, point.y);
        else nd.lineTo(point.x, point.y);
      }
      nd.globalAlpha = 0.08 + 0.8 * (1 - settled);
      nd.strokeStyle = col;
      nd.lineWidth = 1.6;
      nd.shadowBlur = 10;
      nd.shadowColor = col;
      nd.stroke();
      nd.shadowBlur = 0;

      // The travelling head — the thing that actually reads as "a message went
      // from here to there".
      if (travelled < 1) {
        const tip = messagePoint(from, to, bend, travelled);
        const glow = nd.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 15);
        glow.addColorStop(0, col);
        glow.addColorStop(1, `${col}00`);
        nd.globalAlpha = 1;
        nd.beginPath();
        nd.arc(tip.x, tip.y, 15, 0, Math.PI * 2);
        nd.fillStyle = glow;
        nd.fill();
      }
      nd.globalAlpha = 1;
    }
  }

  /** Quadratic bezier core→node with a sideways bow, so strands arc. The bow
   *  alternates by SLOT on purpose — it is a pattern that keeps neighbouring
   *  strands from overlaying each other, not a property of any one node, so
   *  it stays index-keyed while everything else moved to node ids. */
  function curvePoint(i: number, t: number) {
    const p = positions[i]!;
    const mx = (core.x + p.x) / 2;
    const my = (core.y + p.y) / 2;
    const dx = p.x - core.x;
    const dy = p.y - core.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = (i % 2 ? 1 : -1) * Math.min(46, len * 0.16);
    const cx = mx - (dy / len) * bow;
    const cy = my + (dx / len) * bow;
    const u = 1 - t;
    return {
      x: u * u * core.x + 2 * u * t * cx + t * t * p.x,
      y: u * u * core.y + 2 * u * t * cy + t * t * p.y,
      cx,
      cy,
    };
  }

  function drawBackground(t: number) {
    bg.clearRect(0, 0, W, H);
    for (const [i, b] of BLOBS.entries()) {
      // Themed hue if one was handed over, the scene's own violet otherwise.
      // Alpha, size, drift and phase are always the scene's — a recolour, not
      // a different sky.
      const col = ambientCol
        ? ambientCol.blobs[i % ambientCol.blobs.length]!
        : b.col;
      const bx = (b.hx + 0.07 * Math.sin((t / 9000) * b.sp + b.ph)) * W;
      const by = (b.hy + 0.06 * Math.cos((t / 11000) * b.sp + b.ph)) * H;
      const br = b.r * Math.min(W, H) * (1 + 0.08 * Math.sin(t / 7000 + b.ph));
      const g = bg.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(${col},${b.a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      bg.fillStyle = g;
      bg.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    for (const d of stars) {
      if (!reduceMotion) {
        d.y -= d.v;
        if (d.y < -4) {
          d.y = H + 4;
          d.x = Math.random() * W;
        }
      }
      const a = 0.25 + 0.55 * Math.abs(Math.sin(d.tw + t / 2600));
      bg.beginPath();
      bg.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      bg.fillStyle = d.accent
        ? `rgba(${ambientCol ? ambientCol.starAccent : "145,132,217"},${a * 0.8})`
        : `rgba(${ambientCol ? ambientCol.star : "233,233,237"},${a * 0.35})`;
      bg.fill();
    }
  }

  function drawCore(t: number) {
    // The centre is a CONVERSATION (the global primary / the room's own
    // thread), so its ring wears the one-status-one-colour palette; idle
    // keeps the prototype's violet. Working also spins the dashed ring
    // faster — the same "motion is the status" the orbit layout speaks.
    const liveCore = coreStatus !== "idle";
    const coreCol = liveCore ? statusCol[coreStatus] : "#b5abfc";
    const coreGlow = liveCore ? coreCol : "#9184d9";
    // Lighthouse rays — a slow sweep that says "awake".
    for (let k = 0; k < 6; k++) {
      const ang = t / 5200 + (k * Math.PI) / 3;
      const g = nd.createLinearGradient(
        core.x,
        core.y,
        core.x + Math.cos(ang) * 120,
        core.y + Math.sin(ang) * 120,
      );
      g.addColorStop(0, "rgba(145,132,217,0.20)");
      g.addColorStop(1, "rgba(145,132,217,0)");
      nd.beginPath();
      nd.moveTo(core.x + Math.cos(ang) * 40, core.y + Math.sin(ang) * 40);
      nd.lineTo(core.x + Math.cos(ang) * 120, core.y + Math.sin(ang) * 120);
      nd.strokeStyle = g;
      nd.lineWidth = 1;
      nd.stroke();
    }

    const CR = 44;
    const halo = nd.createRadialGradient(
      core.x,
      core.y,
      CR * 0.6,
      core.x,
      core.y,
      CR * 2.9,
    );
    halo.addColorStop(0, "rgba(145,132,217,0.38)");
    halo.addColorStop(0.5, "rgba(145,132,217,0.13)");
    halo.addColorStop(1, "rgba(145,132,217,0)");
    nd.beginPath();
    nd.arc(core.x, core.y, CR * 2.9, 0, Math.PI * 2);
    nd.fillStyle = halo;
    nd.fill();

    const fill = nd.createRadialGradient(core.x, core.y, 4, core.x, core.y, CR);
    fill.addColorStop(0, "#2f2b4d");
    fill.addColorStop(1, "#191b2a");
    nd.beginPath();
    nd.arc(core.x, core.y, CR, 0, Math.PI * 2);
    nd.fillStyle = fill;
    nd.shadowBlur = 46;
    nd.shadowColor = "rgba(165,150,255,0.75)";
    nd.fill();
    nd.shadowBlur = 0;
    nd.strokeStyle = coreCol;
    nd.lineWidth = 2.5;
    nd.shadowBlur = liveCore ? 26 : 18;
    nd.shadowColor = coreGlow;
    nd.stroke();
    nd.shadowBlur = 0;

    nd.beginPath();
    nd.setLineDash([5, 8]);
    nd.lineDashOffset = (-t / 34) * (coreStatus === "building" ? 2.6 : 1);
    nd.arc(core.x, core.y, CR + 11, 0, Math.PI * 2);
    nd.strokeStyle = liveCore ? `${coreCol}b4` : "rgba(181,171,252,0.6)";
    nd.lineWidth = 1.4;
    nd.stroke();
    nd.setLineDash([]);

    nd.fillStyle = "#ffffff";
    // Long workspace names shrink to stay inside the core rather than spill.
    const coreFontPx =
      coreLabel.length > 8 ? Math.max(9, 15 - (coreLabel.length - 8)) : 15;
    nd.font = `700 ${coreFontPx}px Inter, system-ui, sans-serif`;
    nd.textAlign = "center";
    nd.textBaseline = "middle";
    nd.fillText(coreLabel, core.x, core.y);
  }

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    if (!W || !H) return;
    if (introT < 1) introT += dt * 0.9;

    layout(t, dt);
    drawBackground(t);

    // ── fx canvas: fade for trails, then additive glow ──
    fx.globalCompositeOperation = "destination-out";
    fx.fillStyle = "rgba(0,0,0,0.26)";
    fx.fillRect(0, 0, W, H);
    fx.globalCompositeOperation = "lighter";

    nodes.forEach((node, i) => {
      spawnAcc[i] = (spawnAcc[i] ?? 0) + (isLive(node) ? 7 : 0.15) * dt;
      while (spawnAcc[i]! >= 1) {
        spawnAcc[i]! -= 1;
        const dir = Math.random() < 0.5 ? 1 : -1;
        particles.push({
          nodeId: node.id,
          t: dir === 1 ? 0 : 1,
          dir,
          speed: 0.55 + Math.random() * 0.75,
          off: (Math.random() - 0.5) * 8,
          col: statusCol[node.status],
          size: 1.2 + Math.random() * 1.6,
        });
      }
    });

    for (let n = particles.length - 1; n >= 0; n--) {
      const p = particles[n]!;
      p.t += p.speed * p.dir * dt;
      const slot = slotById.get(p.nodeId);
      if (p.t < 0 || p.t > 1 || slot === undefined || !positions[slot]) {
        particles.splice(n, 1);
        continue;
      }
      const pos = curvePoint(slot, p.t);
      fx.beginPath();
      fx.arc(pos.x + p.off, pos.y + p.off * 0.4, p.size * 1.4, 0, Math.PI * 2);
      fx.fillStyle = p.col;
      fx.shadowBlur = 6;
      fx.shadowColor = p.col;
      fx.fill();
      fx.shadowBlur = 0;
    }

    // Satellites around anything actually working.
    nodes.forEach((node, i) => {
      if (!isLive(node) || !positions[i]) return;
      const p = positions[i]!;
      const boost = node.status === "building" ? 1 : 0.25;
      // A moon's own satellites hug it — full-size orbits would lap the core.
      const orbitScale = node.role === "moon" ? 0.45 : 1;
      for (const o of orbiters[i] ?? []) {
        o.ang += o.speed * boost * dt * 2;
        fx.beginPath();
        fx.arc(
          p.x + Math.cos(o.ang) * o.r * orbitScale,
          p.y + Math.sin(o.ang) * o.r * 0.72 * orbitScale,
          1.7,
          0,
          Math.PI * 2,
        );
        fx.fillStyle = statusCol[node.status];
        fx.globalAlpha = 0.9;
        fx.fill();
      }
    });
    fx.globalAlpha = 1;

    // ── crisp canvas ──
    nd.clearRect(0, 0, W, H);
    drawLayoutFurniture();

    // Edges — bright gradient strands with a soft glow.
    nodes.forEach((node, i) => {
      const p = positions[i];
      if (!p) return;
      const cp = curvePoint(i, 0.5);
      const col = statusCol[node.status];
      const idle = node.status === "idle";
      const grad = nd.createLinearGradient(core.x, core.y, p.x, p.y);
      grad.addColorStop(0, "rgba(181,171,252,0.55)");
      grad.addColorStop(1, idle ? "rgba(117,121,140,0.30)" : `${col}aa`);
      nd.beginPath();
      nd.moveTo(core.x, core.y);
      nd.quadraticCurveTo(cp.cx, cp.cy, p.x, p.y);
      nd.strokeStyle = idle ? "rgba(117,121,140,0.25)" : grad;
      nd.lineWidth = idle ? 1 : 1.8;
      if (!idle) {
        nd.shadowBlur = 8;
        nd.shadowColor = col;
      }
      nd.stroke();
      nd.shadowBlur = 0;
    });

    drawMessages(Date.now());

    drawCore(t);

    // Nodes — halo bloom, inner glow, thick ring, label.
    nodes.forEach((node, i) => {
      const p = positions[i];
      if (!p) return;
      const col = statusCol[node.status];
      const idle = node.status === "idle";
      const hovered = hoverIndex === i;
      const isMoon = node.role === "moon";
      const pulse =
        node.status === "waiting" ? 1 + 0.05 * Math.sin(t / 160) : 1;
      const rad = (isMoon ? (hovered ? 17 : 15) : hovered ? 29 : 26) * pulse;

      if (!idle) {
        const breathe = 0.75 + 0.25 * Math.sin(t / 700 + i * 1.7);
        const haloR = rad * (hovered ? 3.4 : 3);
        const halo = nd.createRadialGradient(
          p.x,
          p.y,
          rad * 0.7,
          p.x,
          p.y,
          haloR,
        );
        const hex = (v: number) =>
          Math.round(v * breathe)
            .toString(16)
            .padStart(2, "0");
        halo.addColorStop(0, col + hex(0x66));
        halo.addColorStop(0.45, col + hex(0x28));
        halo.addColorStop(1, `${col}00`);
        nd.beginPath();
        nd.arc(p.x, p.y, haloR, 0, Math.PI * 2);
        nd.fillStyle = halo;
        nd.fill();
      }

      const fill = nd.createRadialGradient(p.x, p.y, 2, p.x, p.y, rad);
      if (idle) {
        fill.addColorStop(0, "#232532");
        fill.addColorStop(1, "#1a1c28");
      } else {
        fill.addColorStop(0, `${col}77`);
        fill.addColorStop(0.55, `${col}2a`);
        fill.addColorStop(1, "#15172a");
      }
      nd.beginPath();
      nd.arc(p.x, p.y, rad, 0, Math.PI * 2);
      nd.fillStyle = fill;
      if (!idle) {
        nd.shadowBlur = hovered ? 44 : 30;
        nd.shadowColor = col;
      }
      nd.fill();
      nd.shadowBlur = 0;

      nd.strokeStyle = col;
      nd.globalAlpha = idle ? 0.75 : 1;
      nd.lineWidth = idle ? 1.6 : hovered ? 4.2 : 3.4;
      if (!idle) {
        nd.shadowBlur = 14;
        nd.shadowColor = col;
      }
      nd.stroke();
      nd.shadowBlur = 0;
      nd.globalAlpha = 1;

      // The node's own face — the customized image clipped inside the disc
      // (the tree row's rule, on canvas); the initials until it loads.
      const face =
        node.imageUrl != null && node.imageUrl !== ""
          ? imageFor(node.imageUrl)
          : null;
      if (face !== null) {
        nd.save();
        nd.beginPath();
        nd.arc(p.x, p.y, rad - 2.5, 0, Math.PI * 2);
        nd.clip();
        nd.globalAlpha = idle ? 0.7 : 1;
        // Cover-fit: fill the disc, crop the overflow.
        const scale = Math.max(
          ((rad - 2.5) * 2) / face.naturalWidth,
          ((rad - 2.5) * 2) / face.naturalHeight,
        );
        const drawW = face.naturalWidth * scale;
        const drawH = face.naturalHeight * scale;
        nd.drawImage(face, p.x - drawW / 2, p.y - drawH / 2, drawW, drawH);
        nd.restore();
      } else {
        nd.fillStyle = idle ? DIM : "#ffffff";
        nd.font = `700 ${isMoon ? 9 : 12}px "Segoe UI Variable Text", system-ui, sans-serif`;
        nd.textAlign = "center";
        nd.textBaseline = "middle";
        nd.fillText(node.initials, p.x, p.y);
      }

      nd.fillStyle = idle ? DIM : "#ffffff";
      nd.font = `600 ${isMoon ? 10.5 : 13}px "Segoe UI Variable Text", system-ui, sans-serif`;
      nd.textAlign = "center";
      nd.textBaseline = "middle";
      nd.fillText(node.name, p.x, p.y + rad + (isMoon ? 15 : 21));

      // A moon is a small mark — its ring already says the state; the caption
      // would be bigger than the dot.
      if (!isMoon) {
        nd.fillStyle = col;
        nd.font = '700 8.5px "Segoe UI Variable Text", system-ui, sans-serif';
        nd.letterSpacing = "1.5px";
        nd.fillText(labelFor(node.status), p.x, p.y + rad + 37);
        nd.letterSpacing = "0px";
      }
    });
  }

  function labelFor(status: SceneNode["status"]): string {
    switch (status) {
      case "building":
        return "WORKING";
      case "waiting":
        return "NEEDS YOU";
      case "problem":
        return "STUCK";
      case "done":
        return "ALL DONE";
      default:
        return "IDLE";
    }
  }

  function hitTest(clientX: number, clientY: number): number {
    const rect = ndCv.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let i = 0; i < positions.length; i++) {
      // A node added by this update has no eased position until the next
      // frame places it — it is not on screen, so it cannot be under the
      // pointer either.
      const p = positions[i];
      if (p === undefined) continue;
      const reach = nodes[i]?.role === "moon" ? 20 : 30;
      if (Math.hypot(x - p.x, y - p.y) <= reach) return i;
    }
    return -1;
  }

  /** The centre under the pointer — only meaningful when it has a click. */
  function isOverCore(clientX: number, clientY: number): boolean {
    if (onCorePick === undefined) return false;
    const rect = ndCv.getBoundingClientRect();
    return (
      Math.hypot(clientX - rect.left - core.x, clientY - rect.top - core.y) <=
      50
    );
  }

  function onMove(event: MouseEvent) {
    hoverIndex = hitTest(event.clientX, event.clientY);
    ndCv.style.cursor =
      hoverIndex >= 0 || isOverCore(event.clientX, event.clientY)
        ? "pointer"
        : "";
  }
  function onClick(event: MouseEvent) {
    const i = hitTest(event.clientX, event.clientY);
    if (i >= 0 && nodes[i]) {
      onPick(nodes[i]!.id);
      return;
    }
    // The dots win over the centre — a moon on its first orbit passes close.
    if (isOverCore(event.clientX, event.clientY)) onCorePick?.();
  }
  ndCv.addEventListener("mousemove", onMove);
  ndCv.addEventListener("mouseleave", () => {
    hoverIndex = -1;
  });
  ndCv.addEventListener("click", onClick);

  raf = requestAnimationFrame(frame);

  return {
    setAmbientColours(colours) {
      ambientCol = colours;
    },
    setStatusColours(colours) {
      statusCol = colours === null ? { ...COL } : { ...colours };
    },
    setNodes(next) {
      // Scratch follows the NODE, not its slot. Keyed by array index, a
      // same-length re-sort — which the overview does on every turn boundary,
      // it is sorted by `lastMessageAt` — silently handed one dot's eased
      // position, particle trail and satellites to another, and a changed
      // COUNT threw away every position so the whole fleet flew in from
      // nowhere (2026-08-19 audit, B7). A node that was on screen keeps
      // exactly what it had; only a genuinely new one starts fresh.
      const inherited = inheritedSlots(
        next.map((node) => node.id),
        slotById,
      );
      // A COPY, never the same object twice: `layout` eases positions in
      // place, so two nodes that ever claimed one id would weld themselves
      // together and fight over one point.
      const keptPositions = inherited.map((slot) => {
        const position = slot === undefined ? undefined : positions[slot];
        return position === undefined
          ? undefined
          : { x: position.x, y: position.y };
      });
      const keptSpawnAcc = inherited.map((slot) =>
        slot === undefined ? 0 : (spawnAcc[slot] ?? 0),
      );
      const keptOrbiters = inherited.map(
        (slot) =>
          (slot === undefined ? undefined : orbiters[slot]) ?? freshOrbiters(),
      );

      // The hover ring is scratch too — left slot-keyed, a re-sort would
      // leave it lit on whichever dot inherited the slot until the pointer
      // moved again.
      hoverIndex = hoverIndex < 0 ? -1 : inherited.indexOf(hoverIndex);

      positions.length = 0;
      keptPositions.forEach((position, i) => {
        // A hole is deliberate: `layout` seeds an unplaced node at its target
        // instead of easing it in from (0,0).
        if (position !== undefined) positions[i] = position;
      });
      positions.length = next.length;
      spawnAcc = keptSpawnAcc;
      orbiters = keptOrbiters;
      nodes = next;
      indexNodes();
    },
    setMessages(next) {
      messages = next;
    },
    setLayout(next) {
      layoutMode = next;
    },
    setCoreLabel(label) {
      coreLabel = label.trim() === "" ? "VYNEL" : label.toUpperCase();
    },
    setCoreStatus(status) {
      coreStatus = status;
    },
    hitTest,
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      ndCv.removeEventListener("mousemove", onMove);
      ndCv.removeEventListener("click", onClick);
      for (const cv of [bgCv, fxCv, ndCv]) cv.remove();
    },
  };
}
