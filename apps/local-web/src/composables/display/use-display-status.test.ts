import { describe, expect, it } from "vitest";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import { activityEnergy } from "./display-orb-state.js";
import {
  appendTelemetry,
  attentionTelemetryRows,
  clockLabel,
  deriveDisplayStatus,
  turnTelemetryRows,
  TELEMETRY_CAP,
  type DisplayStatusFacts,
  type DisplayStatusRow,
} from "./use-display-status.js";

// The derivation is pure on purpose (the working-rail pattern): the Display
// reads six composables, and testing its branches through them would be a
// mocking swamp that proves nothing about what the room shows.
function facts(overrides: Partial<DisplayStatusFacts> = {}): DisplayStatusFacts {
  return {
    linked: true,
    buildingCount: 0,
    needYouCount: 0,
    roomCount: 0,
    roomsWorkingCount: 0,
    roomsNeedingYouCount: 0,
    voiceStatus: null,
    openTaskCount: 0,
    completedTaskCount: 0,
    upcomingScheduleCount: 0,
    accountName: "Chad",
    ...overrides,
  };
}

function rowValue(rows: readonly DisplayStatusRow[], label: string): string {
  return rows.find((row) => row.label === label)!.value;
}
function rowTone(rows: readonly DisplayStatusRow[], label: string): string | undefined {
  return rows.find((row) => row.label === label)!.tone;
}

describe("deriveDisplayStatus", () => {
  it("reads the socket for LINK — unlinked is loud, not silent", () => {
    expect(rowValue(deriveDisplayStatus(facts()).systemRows, "Link")).toBe("connected");
    const offline = deriveDisplayStatus(facts({ linked: false }));
    expect(offline.linked).toBe(false);
    expect(rowValue(offline.systemRows, "Link")).toBe("offline");
    expect(rowTone(offline.systemRows, "Link")).toBe("attention");
  });

  it("counts the strip's two numbers and pluralizes the working row", () => {
    const one = deriveDisplayStatus(facts({ buildingCount: 1, needYouCount: 3 }));
    expect([one.building, one.needYou]).toEqual([1, 3]);
    expect(rowValue(one.systemRows, "Working")).toBe("1 session");
    expect(rowValue(one.systemRows, "Waiting")).toBe("3 need you");

    const many = deriveDisplayStatus(facts({ buildingCount: 2 }));
    expect(rowValue(many.systemRows, "Working")).toBe("2 sessions");
    expect(rowValue(many.systemRows, "Waiting")).toBe("nothing");
  });

  // The orb says "alive", not "answer me" — the WAITING row and the strip's
  // counter are what call you over.
  it("burns on motion: working outranks waiting, and idle rests low", () => {
    expect(deriveDisplayStatus(facts({ buildingCount: 1, needYouCount: 2 })).activity).toBe(
      "working",
    );
    expect(deriveDisplayStatus(facts({ needYouCount: 2 })).activity).toBe("needs-input");
    expect(deriveDisplayStatus(facts()).activity).toBe("idle");
    expect(deriveDisplayStatus(facts({ buildingCount: 1 })).orbEnergy).toBe(
      activityEnergy("working"),
    );
  });

  it("says what the spoken thread is doing, quiet when it has never run", () => {
    expect(rowValue(deriveDisplayStatus(facts()).systemRows, "Voice")).toBe("quiet");
    const waiting = deriveDisplayStatus(facts({ voiceStatus: "needs_input" }));
    expect(rowValue(waiting.systemRows, "Voice")).toBe("waiting on you");
    expect(rowTone(waiting.systemRows, "Voice")).toBe("attention");
    expect(rowTone(deriveDisplayStatus(facts({ voiceStatus: "running" })).systemRows, "Voice")).toBe(
      "live",
    );
  });

  it("rolls the rooms up, and reads empty before the first one exists", () => {
    expect(rowValue(deriveDisplayStatus(facts()).systemRows, "Rooms")).toBe("none yet");
    const rooms = deriveDisplayStatus(
      facts({ roomCount: 4, roomsWorkingCount: 1, roomsNeedingYouCount: 2 }),
    );
    expect(rowValue(rooms.systemRows, "Rooms")).toBe("4 · 1 working · 2 need you");
    expect(rowTone(rooms.systemRows, "Rooms")).toBe("attention");
  });

  it("names the account and its tallies", () => {
    const view = deriveDisplayStatus(
      facts({ openTaskCount: 2, completedTaskCount: 5, upcomingScheduleCount: 1 }),
    );
    expect(rowValue(view.accountRows, "User")).toBe("Chad");
    expect(rowValue(view.accountRows, "Tasks")).toBe("2 open · 5 done");
    expect(rowValue(view.accountRows, "Schedules")).toBe("1 upcoming");
    expect(rowValue(deriveDisplayStatus(facts()).accountRows, "Schedules")).toBe("none upcoming");
  });
});

function turn(overrides: Partial<SessionTurnActivity> = {}): SessionTurnActivity {
  return {
    turnId: "turn-1",
    scopeKind: "global",
    workspaceId: null,
    sessionId: null,
    origin: "web",
    startedAt: "2026-08-21T10:00:00.000Z",
    primarySessionId: null,
    jobId: null,
    threadId: null,
    partialSessionId: null,
    taskLabel: null,
    personaName: null,
    ...overrides,
  };
}

const AT = new Date(2026, 7, 21, 9, 4, 5);

describe("telemetry", () => {
  it("stamps a 24-hour clock, zero-padded, whatever the locale", () => {
    expect(clockLabel(AT)).toBe("09:04:05");
    expect(clockLabel(new Date(2026, 7, 21, 23, 59, 59))).toBe("23:59:59");
  });

  it("logs a turn beginning and ending, by who was working", () => {
    const started = turnTelemetryRows({}, { "turn-1": turn() }, AT);
    expect(started).toEqual([{ label: "09:04:05", value: "Claude started", tone: "live" }]);

    const ended = turnTelemetryRows({ "turn-1": turn() }, {}, AT);
    expect(ended[0]!.value).toBe("Claude finished");
  });

  it("names the voice thread, a persona, and a room by its own name", () => {
    const rows = turnTelemetryRows(
      {},
      {
        a: turn({ turnId: "a", scopeKind: "voice" }),
        b: turn({ turnId: "b", personaName: "Scout" }),
        c: turn({ turnId: "c", scopeKind: "workspace", workspaceId: "ws-1" }),
        d: turn({ turnId: "d", scopeKind: "workspace", workspaceId: "ws-unknown" }),
      },
      AT,
      new Map([["ws-1", "Kitchen"]]),
    );
    expect(rows.map((row) => row.value)).toEqual([
      "Voice started",
      "Scout started",
      "Kitchen started",
      "Room started",
    ]);
  });

  it("says nothing when the map did not move", () => {
    expect(turnTelemetryRows({ "turn-1": turn() }, { "turn-1": turn() }, AT)).toEqual([]);
  });

  // Answering a card is you being there already — only a RISE is news.
  it("logs a rise in what waits on you, never a fall", () => {
    expect(attentionTelemetryRows(0, 2, AT)).toEqual([
      { label: "09:04:05", value: "2 waiting on you", tone: "attention" },
    ]);
    expect(attentionTelemetryRows(2, 1, AT)).toEqual([]);
    expect(attentionTelemetryRows(1, 1, AT)).toEqual([]);
  });

  it("keeps the last 14 lines, newest last", () => {
    let ring: DisplayStatusRow[] = [];
    for (let index = 0; index < TELEMETRY_CAP + 6; index += 1) {
      ring = appendTelemetry(ring, [{ label: "09:04:05", value: `line ${index}` }]);
    }
    expect(ring).toHaveLength(TELEMETRY_CAP);
    expect(ring[0]!.value).toBe("line 6");
    expect(ring.at(-1)!.value).toBe(`line ${TELEMETRY_CAP + 5}`);
  });

  it("an empty change leaves the ring alone", () => {
    const ring = [{ label: "09:04:05", value: "line" }];
    expect(appendTelemetry(ring, [])).toEqual(ring);
  });
});
