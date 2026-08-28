// The /voice surface's remote-engine contracts: a remote engine has no speaker
// and no call cables (its loopback URLs would resolve to the SERVER), so speak
// and every call tool answer honestly WITHOUT probing — while a local engine
// still relays. Full HTTP stack, the capabilities route test's setup style.
// The daemon-relay mechanics themselves are covered in
// calls-through-daemon.test.ts with a stubbed fetch.

import { afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { withTestDatabase } from "@vynel/testing";
import { insertUser } from "@vynel/db/repositories/users";
import { listAllChatSessionsForUser } from "@vynel/chat/repositories";
import {
  DISPLAY_SESSION_CAPTION_MAX_LENGTH,
  type VoiceControlEvent,
} from "@vynel/contracts/voice/daemon-events";
import { createApp } from "../../app.js";
import { TURN_SESSION_HEADER } from "../../sessions/turn-session-header.js";

const silentLogger = pino({ level: "silent" });

function seedUser(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date();
  return insertUser(db, {
    id: randomUUID(),
    displayName: "T",
    emailAddress: null,
    locale: "en-US",
    timezone: "UTC",
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  });
}

async function postSpeak(
  app: ReturnType<typeof createApp>,
  headers: Record<string, string> = {},
): Promise<{ spoken: boolean; reason?: string }> {
  const response = await app.request("/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ text: "hello" }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { spoken: boolean; reason?: string };
}

/** Stand in for the daemon's /speak and record what the api forwarded. */
function stubDaemonSpeak(): Array<{ url: string; body: unknown }> {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the call tools on a remote engine", () => {
  it("start_call refuses without spawning a session or touching the daemon", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger, remoteEngine: true });
      const response = await app.request("/voice/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "9pm standup", mode: "notetaker" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        started: boolean;
        reason?: string;
      };
      expect(body.started).toBe(false);
      expect(body.reason).toContain("remote server");
    });
  });

  it("start_call with capturePid AND captureProcessName refuses BEFORE creating the session", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db);
      // Local engine: past the remote guard — the both-given check must be the
      // one that stops it, and it must stop it before the session side effect
      // (the daemon rejects the pair too, but by then a call session per
      // attempt would already be orphaned in the Sessions panel).
      const app = createApp({ db, logger: silentLogger, remoteEngine: false });
      const response = await app.request("/voice/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "meet",
          capturePid: 10,
          captureProcessName: "chrome",
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        started: boolean;
        reason?: string;
      };
      expect(body.started).toBe(false);
      expect(body.reason).toContain("not both");
      expect(listAllChatSessionsForUser(db, { userId: user.id })).toEqual([]);
    });
  });

  it("list_calls answers empty and end_call answers honestly", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger, remoteEngine: true });

      const listed = await app.request("/voice/calls");
      expect(await listed.json()).toEqual({ calls: [] });

      const ended = await app.request("/voice/calls/call-1", {
        method: "DELETE",
      });
      const endedBody = (await ended.json()) as {
        ended: boolean;
        reason?: string;
      };
      expect(endedBody.ended).toBe(false);
      expect(endedBody.reason).toContain("remote server");
    });
  });

  it("speak with a callId refuses the same way", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger, remoteEngine: true });
      const response = await app.request("/voice/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello", callId: "call-1" }),
      });
      const body = (await response.json()) as {
        spoken: boolean;
        reason?: string;
      };
      expect(body.spoken).toBe(false);
      expect(body.reason).toContain("remote server");
    });
  });
});

describe("POST /voice/speak", () => {
  it("answers unavailable on a remote engine without touching the daemon", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger, remoteEngine: true });
      const body = await postSpeak(app);
      expect(body.spoken).toBe(false);
      expect(body.reason).toContain("remote server");
    });
  });

  it("forwards the ambient turn session to the daemon as the producing session", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger });
      const calls = stubDaemonSpeak();
      // The header is server-stamped per turn (never model input) — the daemon
      // routes the relayed line by it.
      const body = await postSpeak(app, { [TURN_SESSION_HEADER]: "chat-7" });
      expect(body).toEqual({ spoken: true });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toMatch(/\/speak$/);
      expect(calls[0]?.body).toEqual({ text: "hello", sessionId: "chat-7" });
    });
  });

  it("forwards sessionId: null when the caller has no turn session (a schedule fire)", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger });
      const calls = stubDaemonSpeak();
      await postSpeak(app);
      expect(calls[0]?.body).toEqual({ text: "hello", sessionId: null });
    });
  });

  it("takes the relay path on a local engine, whatever the daemon answers", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger });
      const body = await postSpeak(app);
      // Deliberately NOT asserting spoken/true-or-false: a dev machine may
      // have a real voice daemon on the loopback port (it did — this test
      // failed that way once). The invariant is that the REMOTE short-circuit
      // stayed out of the way, so the relay is what answered.
      expect(body.reason ?? "").not.toContain("remote server");
    });
  });
});

describe("POST /voice/display-active", () => {
  it("hands the app window’s Display state to the live channel, scoped to that user", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db);
      const published: Array<{ userId: string; frame: VoiceControlEvent }> = [];
      const app = createApp({
        db,
        logger: silentLogger,
        voiceControlSink: {
          publish: (userId, frame) => published.push({ userId, frame }),
        },
      });

      const response = await app.request("/voice/display-active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ published: true });
      expect(published).toEqual([
        { userId: user.id, frame: { kind: "display-active", active: true } },
      ]);
    });
  });

  it("answers published: false without a live channel, and refuses a non-boolean", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger });

      const noSink = await app.request("/voice/display-active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      expect(noSink.status).toBe(200);
      expect(await noSink.json()).toEqual({ published: false });

      const bad = await app.request("/voice/display-active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: "yes" }),
      });
      expect(bad.status).toBe(400);
    });
  });
});

describe("POST /voice/stop-listening", () => {
  it("fans the stop to the user’s voice windows and asks the daemon too", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db);
      const published: Array<{ userId: string; frame: VoiceControlEvent }> = [];
      const daemonCalls: string[] = [];
      vi.stubGlobal("fetch", (url: string | URL) => {
        daemonCalls.push(String(url));
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      });
      const app = createApp({
        db,
        logger: silentLogger,
        voiceControlSink: {
          publish: (userId, frame) => published.push({ userId, frame }),
        },
      });

      const response = await app.request("/voice/stop-listening", {
        method: "POST",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ stopped: true });
      expect(published).toEqual([
        { userId: user.id, frame: { kind: "voice-stop" } },
      ]);
      expect(daemonCalls[0]).toContain("/stop-listening");
    });
  });

  it("skips the daemon on a remote engine, and says so when nowhere heard it", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const daemonCalls: string[] = [];
      vi.stubGlobal("fetch", (url: string | URL) => {
        daemonCalls.push(String(url));
        return Promise.reject(new Error("no daemon"));
      });

      // Remote + a live channel: the windows still hear the stop.
      const published: VoiceControlEvent[] = [];
      const remote = createApp({
        db,
        logger: silentLogger,
        remoteEngine: true,
        voiceControlSink: {
          publish: (_userId, frame) => published.push(frame),
        },
      });
      const heard = await remote.request("/voice/stop-listening", {
        method: "POST",
      });
      expect(await heard.json()).toEqual({ stopped: true });
      expect(published).toEqual([{ kind: "voice-stop" }]);
      expect(daemonCalls).toEqual([]);

      // No channel and no daemon: an honest false, not a silent success.
      const deaf = createApp({ db, logger: silentLogger });
      const unheard = await deaf.request("/voice/stop-listening", {
        method: "POST",
      });
      expect(unheard.status).toBe(200);
      const body = (await unheard.json()) as {
        stopped: boolean;
        reason?: string;
      };
      expect(body.stopped).toBe(false);
      expect(body.reason).toContain("hear");
    });
  });
});

describe("POST /voice/display-session", () => {
  it("hands the room’s live conversation to the live channel, scoped to that user", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db);
      const published: Array<{ userId: string; frame: VoiceControlEvent }> = [];
      const app = createApp({
        db,
        logger: silentLogger,
        voiceControlSink: {
          publish: (userId, frame) => published.push({ userId, frame }),
        },
      });

      const response = await app.request("/voice/display-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          live: true,
          phase: "speaking",
          caption: "Two builds are green",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ published: true });
      expect(published).toEqual([
        {
          userId: user.id,
          frame: {
            kind: "display-session",
            live: true,
            phase: "speaking",
            caption: "Two builds are green",
          },
        },
      ]);
    });
  });

  it("answers published: false without a live channel, and refuses a phase it does not know", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger });

      const noSink = await app.request("/voice/display-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ live: false, phase: "idle", caption: "" }),
      });
      expect(noSink.status).toBe(200);
      expect(await noSink.json()).toEqual({ published: false });

      // `wake` belongs to the daemon leg — a window's own session never reaches it.
      const bad = await app.request("/voice/display-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ live: true, phase: "wake", caption: "" }),
      });
      expect(bad.status).toBe(400);
    });
  });

  // The producer clamps to this very number, so the longest caption it can
  // ever send is the longest one this route accepts — one shared const, no
  // silent 400 that would freeze the dock's row mid-reply.
  it("accepts a caption of exactly the contract’s cap, and refuses one past it", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const app = createApp({ db, logger: silentLogger });
      const post = (caption: string) =>
        app.request("/voice/display-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ live: true, phase: "speaking", caption }),
        });

      const atCap = await post("x".repeat(DISPLAY_SESSION_CAPTION_MAX_LENGTH));
      expect(atCap.status).toBe(200);

      const overCap = await post(
        "x".repeat(DISPLAY_SESSION_CAPTION_MAX_LENGTH + 1),
      );
      expect(overCap.status).toBe(400);
    });
  });
});

describe("POST /voice/latency-trace", () => {
  it("logs one INFO line carrying the marks and answers logged: true", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      // A real pino over a capturing sink — the log line IS the deliverable
      // (the numbers in the dev terminal), so the test reads it back.
      const lines: string[] = [];
      const collector = pino(
        { level: "info" },
        { write: (line: string) => void lines.push(line) },
      );
      const app = createApp({ db, logger: collector });

      const response = await app.request("/voice/latency-trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startedAt: "2026-08-27T12:00:00.000Z",
          marks: {
            speechEnd: 0,
            dispatch: 40,
            firstToken: 1200,
            firstTts: 2000,
            firstAudible: 2150,
          },
          speechEndToDispatchMs: 40,
          dispatchToFirstTokenMs: 1160,
          firstTokenToFirstTtsMs: 800,
          firstTtsToFirstAudibleMs: 150,
          speechEndToFirstAudibleMs: 2150,
          complete: true,
          endpointSilenceMs: 1500,
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ logged: true });
      const traceLine = lines.find((line) => line.includes("voice latency"));
      expect(traceLine).toBeDefined();
      // The message names the figure Chad feels; the payload carries the rest.
      expect(traceLine).toContain("2150ms speech->first-sound");
      expect(traceLine).toContain('"endpointSilenceMs":1500');
    });
  });

  it("logs a partial trace with its reason, and refuses a shapeless body", async () => {
    await withTestDatabase(async (db) => {
      seedUser(db);
      const lines: string[] = [];
      const collector = pino(
        { level: "info" },
        { write: (line: string) => void lines.push(line) },
      );
      const app = createApp({ db, logger: collector });

      const partial = await app.request("/voice/latency-trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startedAt: "2026-08-27T12:00:00.000Z",
          marks: { speechEnd: 0, dispatch: 60 },
          speechEndToDispatchMs: 60,
          complete: false,
          reason: "turn-settled",
        }),
      });
      expect(partial.status).toBe(200);
      expect(
        lines.find((line) => line.includes("partial trace (turn-settled)")),
      ).toBeDefined();

      const garbage = await app.request("/voice/latency-trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ complete: "yes" }),
      });
      expect(garbage.status).toBe(400);
    });
  });
});
