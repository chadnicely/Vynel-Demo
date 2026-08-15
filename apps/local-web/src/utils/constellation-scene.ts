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
// the seam it does have — the data mapping — already lives in
// constellation-layout.ts where it can be tested without a canvas.
//
// The look is Nocturne's, not the token bridge's — the prototype's exact
// violets, because these are literal canvas paint values (gradients, glow
// colors, alpha ramps) rather than themeable surfaces.

export interface SceneNode {
  id: string;
  name: string;
  initials: string;
  /** Drives colour, glow and the orbiters — the five fleet states. */
  status: "building" | "waiting" | "problem" | "done" | "idle";
}

// ONE state, ONE colour WITHIN this screen (Chad, 2026-08-12): working (a live
// turn, or a queue running a task) is PURPLE, completed is green, waiting on
// YOU is orange, a problem is red, idle is grey. The palette is scene-local —
// main's other surfaces render `WorkspaceEffectiveStatus` — and `problem` is
// the one state nothing feeds here yet.
const COL: Record<SceneNode["status"], string> = {
  building: "#b5abfc",
  waiting: "#ff9a3d",
  problem: "#ef4444",
  done: "#4ade80",
  idle: "#75798c",
};
const DIM = "#9397ab";

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
  i: number;
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

export interface SceneHandle {
  setNodes(nodes: SceneNode[]): void;
  setLayout(layout: SceneLayout): void;
  /** The centre carries the WORKSPACE's name — "NICELY MEDIA", not a brand. */
  setCoreLabel(label: string): void;
  /** Index under the pointer, or -1 — the view drives its own tooltip. */
  hitTest(clientX: number, clientY: number): number;
  destroy(): void;
}

export function startConstellationScene(
  host: HTMLElement,
  initialNodes: SceneNode[],
  onPick: (id: string) => void,
): SceneHandle {
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
      setNodes() {},
      setLayout() {},
      setCoreLabel() {},
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
  let W = 0;
  let H = 0;
  let dpr = 1;
  let stars: Star[] = [];
  let raf = 0;
  let last = 0;
  let introT = 0;
  let hoverIndex = -1;
  let layoutMode: SceneLayout = "constellation";
  const positions: Array<{ x: number; y: number }> = [];
  const core = { x: 0, y: 0 };
  const particles: Particle[] = [];
  let spawnAcc: number[] = [];
  let orbiters: Orbiter[][] = [];

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, x), 3);

  function seedPerNode() {
    spawnAcc = nodes.map(() => 0);
    orbiters = nodes.map(() =>
      Array.from({ length: 3 }, (_, k) => ({
        ang: Math.random() * Math.PI * 2,
        r: 34 + k * 6,
        speed: 2.2 + Math.random() * 1.8,
      })),
    );
  }
  seedPerNode();

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
    const n = nodes.length;
    let target: { x: number; y: number };
    const wanted: Array<{ x: number; y: number }> = [];

    if (layoutMode === "orbit") {
      target = { x: W / 2, y: H / 2 + 6 };
      const lane = (i: number) =>
        Math.min(W * 0.46, H * 0.47) * (0.3 + 0.115 * i);
      nodes.forEach((node, i) => {
        // Anything working laps the core faster — motion IS the status here.
        const ang =
          i * 2.39996 +
          t * 0.00005 * (1.7 - i * 0.13) * (isLive(node) ? 2.1 : 0.7);
        wanted[i] = {
          x: target.x + Math.cos(ang) * lane(i) * k,
          y: target.y + Math.sin(ang) * lane(i) * 0.82 * k,
        };
      });
    } else if (layoutMode === "rise") {
      // The floor clears the layout pill + hint at the bottom of the stage
      // (Chad, 2026-08-11: nodes were sitting on the selectors).
      target = { x: W / 2, y: H - 200 };
      const { y0, y1 } = riseBand();
      nodes.forEach((node, i) => {
        const x = Math.min(
          W - 80,
          Math.max(80, W * 0.5 + (i - (n - 1) / 2) * Math.min(W, 1300) * 0.115),
        );
        // Height = how far along it is. Nothing reports progress yet, so a
        // working node floats mid-band and everything else sits on the floor.
        const frac = isLive(node) ? 0.5 : 0;
        wanted[i] = {
          x: x + Math.sin(t / 1700 + i * 2.1) * 6,
          y: y0 - (y0 - y1) * frac * k + Math.cos(t / 1400 + i * 1.3) * 5,
        };
      });
    } else {
      target = { x: W / 2, y: H / 2 + 6 };
      const rx = Math.max(180, Math.min(W * 0.37, 520)) * k;
      const ry = Math.max(130, Math.min(H * 0.36, 300)) * k;
      nodes.forEach((_, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        wanted[i] = {
          x: target.x + Math.cos(ang) * rx + Math.sin(t / 1700 + i * 2.1) * 7,
          y: target.y + Math.sin(ang) * ry + Math.cos(t / 1400 + i * 1.3) * 6,
        };
      });
    }

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

  /** Guide furniture the layout needs to be readable: orbit lanes, or the
   *  altitude scale Rise measures against. */
  function drawLayoutFurniture() {
    if (layoutMode === "orbit") {
      nodes.forEach((node, i) => {
        const lane = Math.min(W * 0.46, H * 0.47) * (0.3 + 0.115 * i);
        nd.beginPath();
        nd.ellipse(core.x, core.y, lane, lane * 0.82, 0, 0, Math.PI * 2);
        nd.strokeStyle = isLive(node)
          ? "rgba(145,132,217,0.13)"
          : "rgba(145,132,217,0.06)";
        nd.lineWidth = 1;
        nd.stroke();
      });
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

  /** Quadratic bezier core→node with a sideways bow, so strands arc. */
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
    for (const b of BLOBS) {
      const bx = (b.hx + 0.07 * Math.sin((t / 9000) * b.sp + b.ph)) * W;
      const by = (b.hy + 0.06 * Math.cos((t / 11000) * b.sp + b.ph)) * H;
      const br = b.r * Math.min(W, H) * (1 + 0.08 * Math.sin(t / 7000 + b.ph));
      const g = bg.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(${b.col},${b.a})`);
      g.addColorStop(1, `rgba(${b.col},0)`);
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
        ? `rgba(145,132,217,${a * 0.8})`
        : `rgba(233,233,237,${a * 0.35})`;
      bg.fill();
    }
  }

  function drawCore(t: number) {
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
      core.x, core.y, CR * 0.6, core.x, core.y, CR * 2.9,
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
    nd.strokeStyle = "#b5abfc";
    nd.lineWidth = 2.5;
    nd.shadowBlur = 18;
    nd.shadowColor = "#9184d9";
    nd.stroke();
    nd.shadowBlur = 0;

    nd.beginPath();
    nd.setLineDash([5, 8]);
    nd.lineDashOffset = -t / 34;
    nd.arc(core.x, core.y, CR + 11, 0, Math.PI * 2);
    nd.strokeStyle = "rgba(181,171,252,0.6)";
    nd.lineWidth = 1.4;
    nd.stroke();
    nd.setLineDash([]);

    nd.fillStyle = "#ffffff";
    // Long workspace names shrink to stay inside the core rather than spill.
    const coreFontPx = coreLabel.length > 8 ? Math.max(9, 15 - (coreLabel.length - 8)) : 15;
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
          i,
          t: dir === 1 ? 0 : 1,
          dir,
          speed: 0.55 + Math.random() * 0.75,
          off: (Math.random() - 0.5) * 8,
          col: COL[node.status],
          size: 1.2 + Math.random() * 1.6,
        });
      }
    });

    for (let n = particles.length - 1; n >= 0; n--) {
      const p = particles[n]!;
      p.t += p.speed * p.dir * dt;
      if (p.t < 0 || p.t > 1 || !positions[p.i]) {
        particles.splice(n, 1);
        continue;
      }
      const pos = curvePoint(p.i, p.t);
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
      for (const o of orbiters[i] ?? []) {
        o.ang += o.speed * boost * dt * 2;
        fx.beginPath();
        fx.arc(
          p.x + Math.cos(o.ang) * o.r,
          p.y + Math.sin(o.ang) * o.r * 0.72,
          1.7,
          0,
          Math.PI * 2,
        );
        fx.fillStyle = COL[node.status];
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
      const col = COL[node.status];
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

    drawCore(t);

    // Nodes — halo bloom, inner glow, thick ring, label.
    nodes.forEach((node, i) => {
      const p = positions[i];
      if (!p) return;
      const col = COL[node.status];
      const idle = node.status === "idle";
      const hovered = hoverIndex === i;
      const pulse =
        node.status === "waiting" ? 1 + 0.05 * Math.sin(t / 160) : 1;
      const rad = (hovered ? 29 : 26) * pulse;

      if (!idle) {
        const breathe = 0.75 + 0.25 * Math.sin(t / 700 + i * 1.7);
        const haloR = rad * (hovered ? 3.4 : 3);
        const halo = nd.createRadialGradient(p.x, p.y, rad * 0.7, p.x, p.y, haloR);
        const hex = (v: number) =>
          Math.round(v * breathe).toString(16).padStart(2, "0");
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

      nd.fillStyle = idle ? DIM : "#ffffff";
      nd.font = '700 12px "Segoe UI Variable Text", system-ui, sans-serif';
      nd.textAlign = "center";
      nd.textBaseline = "middle";
      nd.fillText(node.initials, p.x, p.y);

      nd.fillStyle = idle ? DIM : "#ffffff";
      nd.font = '600 13px "Segoe UI Variable Text", system-ui, sans-serif';
      nd.fillText(node.name, p.x, p.y + rad + 21);

      nd.fillStyle = col;
      nd.font = '700 8.5px "Segoe UI Variable Text", system-ui, sans-serif';
      nd.letterSpacing = "1.5px";
      nd.fillText(labelFor(node.status), p.x, p.y + rad + 37);
      nd.letterSpacing = "0px";
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
      const p = positions[i]!;
      if (Math.hypot(x - p.x, y - p.y) <= 30) return i;
    }
    return -1;
  }

  function onMove(event: MouseEvent) {
    hoverIndex = hitTest(event.clientX, event.clientY);
    ndCv.style.cursor = hoverIndex >= 0 ? "pointer" : "";
  }
  function onClick(event: MouseEvent) {
    const i = hitTest(event.clientX, event.clientY);
    if (i >= 0 && nodes[i]) onPick(nodes[i]!.id);
  }
  ndCv.addEventListener("mousemove", onMove);
  ndCv.addEventListener("mouseleave", () => {
    hoverIndex = -1;
  });
  ndCv.addEventListener("click", onClick);

  raf = requestAnimationFrame(frame);

  return {
    setNodes(next) {
      // Positions survive a status-only change so nothing jumps; a changed
      // set re-seeds the per-node scratch.
      if (next.length !== nodes.length) {
        positions.length = 0;
        particles.length = 0;
      }
      nodes = next;
      if (spawnAcc.length !== next.length) seedPerNode();
    },
    setLayout(next) {
      layoutMode = next;
    },
    setCoreLabel(label) {
      coreLabel = label.trim() === "" ? "VYNEL" : label.toUpperCase();
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
