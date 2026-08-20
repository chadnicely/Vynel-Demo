// The RAIL IDENTITY CENSUS — the web-side sibling of the api's
// `continuity-census.test.ts`: every production `activityFeed.begin(...)`
// producer is on a known roster, and every frame shape those producers emit
// (copied from the source, as the feed publishes it after null-defaulting) is
// placed by the rail through the one identity matcher. A reader that keys on
// a field's presence instead of identity stays green until the wire moves
// under it — that is how the rail broke (audit R2-A). Here, a new producer
// fails the roster until its frame is added below, WITH its expected chip.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import { resolveRailChip, type RailChip } from "./use-working-rail.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);
const SOURCE_ROOTS = ["apps", "packages"] as const;
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "generated",
  "test-support",
  "target",
  "payload",
]);
// A call on the feed — the handle name is the same in every producer. Spans
// lines (one producer breaks before `.begin`); comment lines are dropped first.
const BEGIN_CALL = /activityFeed\s*\.\s*begin\(/;

/** The producers today — 8 files. Bump deliberately, with a frame below. */
const KNOWN_PRODUCERS = [
  "apps/local-api/src/sessions/run-global-root-turn.ts",
  "apps/local-api/src/sessions/start-fired-workspace-turn.ts",
  "apps/local-api/src/streams/chat-turn.ts",
  "apps/local-api/src/streams/global-root-turn.ts",
  "apps/local-api/src/streams/session-turn.ts",
  "packages/session/src/delegation/run-agent-run-job.ts",
  "packages/session/src/delegation/run-report-delivery-tick.ts",
  "packages/session/src/delegation/run-task-job.ts",
];

function* productionSourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* productionSourceFiles(full);
      continue;
    }
    if (
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".d.ts")
    ) {
      continue;
    }
    yield full;
  }
}

function beginsOnTheFeed(file: string): boolean {
  const code = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
  return BEGIN_CALL.test(code);
}

function producerCensus(): string[] {
  const producers: string[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of productionSourceFiles(path.join(repoRoot, root))) {
      if (beginsOnTheFeed(file)) {
        producers.push(path.relative(repoRoot, file).split(path.sep).join("/"));
      }
    }
  }
  return producers.sort();
}

// ── The frames, producer by producer ─────────────────────────────────────────

const GLOBAL_PRIMARY = "global-primary-1";
const VOICE_PRIMARY = "voice-primary-1";

/** What `SessionActivityFeed.begin` publishes for a producer's input: the
 *  optional enrichment null-defaulted, `workspaceId`/`sessionId` null unless
 *  the producer passed them. */
function published(
  input: Pick<SessionTurnActivity, "scopeKind" | "origin"> &
    Partial<Omit<SessionTurnActivity, "turnId" | "startedAt">>,
): SessionTurnActivity {
  return {
    turnId: "turn-1",
    startedAt: "2026-08-20T10:00:00.000Z",
    workspaceId: null,
    sessionId: null,
    primarySessionId: null,
    jobId: null,
    threadId: null,
    partialSessionId: null,
    taskLabel: null,
    personaName: null,
    ...input,
  };
}

type ProducerFrame = {
  /** Which `begin` this is — named after the producer's own comment. */
  label: string;
  frame: SessionTurnActivity;
  /** The chip once the global primary id is known. */
  chip: RailChip | null;
  /** The chip while the continuing read is still loading (null = not placed). */
  chipBeforeGlobalIdKnown: RailChip | null;
};

const brain: RailChip = { kind: "brain" };
const voice: RailChip = { kind: "voice" };
const session = (primarySessionId: string): RailChip => ({ kind: "session", primarySessionId });
const room = (workspaceId: string): RailChip => ({ kind: "workspace", workspaceId });

const FRAMES_BY_PRODUCER: Record<string, ProducerFrame[]> = {
  "apps/local-api/src/streams/global-root-turn.ts": [
    {
      label: "the user's own global turn",
      frame: published({ scopeKind: "global", origin: "web", primarySessionId: GLOBAL_PRIMARY }),
      chip: brain,
      chipBeforeGlobalIdKnown: null,
    },
    {
      label: "the spoken thread (overlay / panel leg)",
      frame: published({ scopeKind: "voice", origin: "voice", primarySessionId: VOICE_PRIMARY }),
      chip: voice,
      chipBeforeGlobalIdKnown: voice,
    },
  ],
  "apps/local-api/src/sessions/run-global-root-turn.ts": [
    ...(["telegram", "discord", "zoom"] as const).map((origin) => ({
      label: `a ${origin} background root turn`,
      frame: published({ scopeKind: "global", origin, primarySessionId: GLOBAL_PRIMARY }),
      chip: brain,
      chipBeforeGlobalIdKnown: null,
    })),
    {
      label: "a report-delivery notify turn on the root (speaks as the child)",
      frame: published({
        scopeKind: "global",
        origin: "delegation",
        primarySessionId: GLOBAL_PRIMARY,
        jobId: "job-1",
        threadId: "thread-1",
        partialSessionId: "hop-1",
        personaName: "Noah · Invoices",
      }),
      chip: brain,
      chipBeforeGlobalIdKnown: null,
    },
    {
      label: "a global schedule fire (BT1 — through the global runner)",
      frame: published({ scopeKind: "global", origin: "schedule", primarySessionId: GLOBAL_PRIMARY }),
      chip: brain,
      chipBeforeGlobalIdKnown: null,
    },
  ],
  "apps/local-api/src/streams/chat-turn.ts": [
    {
      label: "a room's own web turn (fresh — no session yet)",
      frame: published({ scopeKind: "workspace", workspaceId: "ws-1", origin: "web" }),
      chip: room("ws-1"),
      chipBeforeGlobalIdKnown: room("ws-1"),
    },
    {
      label: "a room's own web turn (resumed)",
      frame: published({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        sessionId: "room-segment-1",
        origin: "web",
      }),
      chip: room("ws-1"),
      chipBeforeGlobalIdKnown: room("ws-1"),
    },
  ],
  "apps/local-api/src/streams/session-turn.ts": [
    {
      label: "a direct send into a spawned session (global-grounded)",
      frame: published({
        scopeKind: "global",
        sessionId: "spawned-segment-1",
        origin: "web",
        primarySessionId: "spawned-1",
      }),
      chip: session("spawned-1"),
      chipBeforeGlobalIdKnown: null,
    },
    {
      label: "a live-call leg into a spawned session — origin voice, NOT the spoken thread",
      frame: published({
        scopeKind: "global",
        sessionId: "spawned-segment-1",
        origin: "voice",
        primarySessionId: "spawned-1",
      }),
      chip: session("spawned-1"),
      chipBeforeGlobalIdKnown: null,
    },
    {
      label: "a direct send to an agent colleague (under its grounding room)",
      frame: published({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        sessionId: "agent-segment-1",
        origin: "web",
        primarySessionId: "agent-1",
      }),
      chip: session("agent-1"),
      chipBeforeGlobalIdKnown: session("agent-1"),
    },
  ],
  "apps/local-api/src/sessions/start-fired-workspace-turn.ts": [
    // Schedule-on-primary (2026-08-20): a workspace fire runs ON the room's
    // continuing conversation and its frame names that identity — the rail
    // shows the NAMED conversation chip (label + segment resolved from the
    // sessions overview by the primary id), and clicking it opens the live
    // thread. Before this the frame named no primary and railed as the bare
    // room chip while the fire ran in an invisible background session.
    {
      label: "a workspace schedule fire on the continuing conversation (resumed head)",
      frame: published({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        sessionId: "room-segment-1",
        origin: "schedule",
        primarySessionId: "room-primary-1",
      }),
      chip: session("room-primary-1"),
      chipBeforeGlobalIdKnown: session("room-primary-1"),
    },
    {
      label:
        "a workspace schedule fire, first-ever (primary registered db-first, segment resolves mid-turn)",
      frame: published({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        origin: "schedule",
        primarySessionId: "room-primary-1",
      }),
      chip: session("room-primary-1"),
      chipBeforeGlobalIdKnown: session("room-primary-1"),
    },
  ],
  "packages/session/src/delegation/run-task-job.ts": [
    {
      label: "a delegated task on a workspace root",
      frame: published({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        origin: "delegation",
        jobId: "job-1",
        threadId: "thread-1",
        partialSessionId: "hop-1",
        taskLabel: "Set up the login page",
        personaName: "Invoices",
      }),
      chip: room("ws-1"),
      chipBeforeGlobalIdKnown: room("ws-1"),
    },
    {
      label: "a delegated task on a spawned session (global-grounded)",
      frame: published({
        scopeKind: "global",
        origin: "delegation",
        jobId: "job-2",
        partialSessionId: "hop-2",
        primarySessionId: "spawned-1",
        taskLabel: "Reconcile July",
        personaName: "July run",
      }),
      chip: session("spawned-1"),
      chipBeforeGlobalIdKnown: null,
    },
    {
      label: "a note delivered to a spawned session (no task label)",
      frame: published({
        scopeKind: "global",
        origin: "delegation",
        jobId: "job-3",
        primarySessionId: "spawned-1",
        personaName: "Noah",
      }),
      chip: session("spawned-1"),
      chipBeforeGlobalIdKnown: null,
    },
  ],
  "packages/session/src/delegation/run-agent-run-job.ts": [
    {
      // Audit R2-K: the announce moved AFTER the resolution phase, so the
      // colleague identity is always on the frame — an unstamped (legacy /
      // failed-resolve) row can no longer rail as the grounding ROOM. The one
      // frame left without an identity is the resolution FAILURE below, which
      // opens and ends in the same breath: the room's problem signal, with no
      // live thread for any view to bind to.
      label: "a colleague run under its grounding room",
      frame: published({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        origin: "delegation",
        jobId: "job-4",
        primarySessionId: "agent-1",
        taskLabel: "Review the PR",
        personaName: "Noah",
      }),
      chip: session("agent-1"),
      chipBeforeGlobalIdKnown: session("agent-1"),
    },
    {
      label: "a colleague run grounded globally",
      frame: published({
        scopeKind: "global",
        origin: "delegation",
        jobId: "job-5",
        primarySessionId: "agent-1",
        taskLabel: "Review the PR",
        personaName: "Noah",
      }),
      chip: session("agent-1"),
      chipBeforeGlobalIdKnown: null,
    },
    {
      label: "a colleague run whose resolution failed (begin + end, the room's problem signal)",
      frame: published({
        scopeKind: "workspace",
        workspaceId: "ws-1",
        origin: "delegation",
        jobId: "job-5b",
        taskLabel: "Review the PR",
        personaName: "Noah",
      }),
      chip: room("ws-1"),
      chipBeforeGlobalIdKnown: room("ws-1"),
    },
  ],
  "packages/session/src/delegation/run-report-delivery-tick.ts": [
    {
      label: "a direct delivery onto the root (begin + end, no notify turn)",
      frame: published({
        scopeKind: "global",
        origin: "delegation",
        jobId: "job-6",
        personaName: "Noah · Invoices",
      }),
      chip: brain,
      chipBeforeGlobalIdKnown: brain,
    },
    {
      label: "a workspace notify turn (speaks as the child)",
      frame: published({
        scopeKind: "workspace",
        workspaceId: "ws-requester",
        origin: "delegation",
        jobId: "job-7",
        personaName: "Noah · Invoices",
      }),
      chip: room("ws-requester"),
      chipBeforeGlobalIdKnown: room("ws-requester"),
    },
  ],
};

describe("rail identity census", () => {
  it("the feed-producer roster is the known one (bump deliberately, WITH the new producer's frame below)", () => {
    expect(producerCensus()).toEqual(KNOWN_PRODUCERS);
  });

  it("every producer on the roster has its frames in the table", () => {
    expect(Object.keys(FRAMES_BY_PRODUCER).sort()).toEqual(KNOWN_PRODUCERS);
  });

  describe("every producer frame is placed by identity", () => {
    for (const [producer, frames] of Object.entries(FRAMES_BY_PRODUCER)) {
      for (const { label, frame, chip, chipBeforeGlobalIdKnown } of frames) {
        it(`${path.basename(producer)} — ${label}`, () => {
          expect(resolveRailChip(frame, GLOBAL_PRIMARY)).toEqual(chip);
          expect(resolveRailChip(frame, null)).toEqual(chipBeforeGlobalIdKnown);
        });
      }
    }
  });

  it("no frame on the wire reaches the brain by a channel/origin guess — only the global primary does", () => {
    const brainFrames = Object.values(FRAMES_BY_PRODUCER)
      .flat()
      .filter(({ chip }) => chip?.kind === "brain")
      .map(({ frame }) => frame);
    expect(brainFrames.length).toBeGreaterThan(0);
    for (const frame of brainFrames) {
      // A global-family frame naming some OTHER primary is never the brain's,
      // whatever its origin says.
      expect(resolveRailChip({ ...frame, primarySessionId: "spawned-9" }, GLOBAL_PRIMARY)).toEqual(
        session("spawned-9"),
      );
    }
  });
});
