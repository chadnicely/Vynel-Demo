// Turning wire edges into arcs. A line drawn between the wrong pair is a
// picture that lies about who talked to whom, so both levels' endpoint
// resolution is pinned here — including the two that must NOT draw.

import { describe, expect, it } from "vitest";
import {
  fleetMessages,
  projectMessages,
  type MessageEdgeLike,
} from "./message-scene-mapping.js";

const AT = "2026-08-15T12:00:00.000Z";

function edge(overrides: Partial<MessageEdgeLike> = {}): MessageEdgeLike {
  return {
    jobId: "job-1",
    direction: "ask",
    fromSessionId: "session-home",
    toSessionId: null,
    fromWorkspaceId: "ws-home",
    toWorkspaceId: "ws-acme",
    at: AT,
    ...overrides,
  };
}

describe("fleetMessages", () => {
  const drawn = new Set(["workspace:ws-home", "workspace:ws-acme"]);

  it("draws room to room when both are on screen", () => {
    expect(fleetMessages([edge()], drawn)).toEqual([
      {
        id: "job-1",
        fromId: "workspace:ws-home",
        toId: "workspace:ws-acme",
        direction: "ask",
        sentAt: Date.parse(AT),
      },
    ]);
  });

  it("an endpoint that is not on screen becomes the core", () => {
    // The global root has no workspace — the message really did come from the
    // centre of this picture.
    const [message] = fleetMessages(
      [edge({ fromWorkspaceId: null })],
      new Set(["workspace:ws-acme"]),
    );
    expect(message).toMatchObject({ fromId: null, toId: "workspace:ws-acme" });
  });

  it("drops a message with both ends off screen", () => {
    expect(fleetMessages([edge()], new Set(["workspace:ws-other"]))).toEqual([]);
  });

  it("never draws a room talking to itself", () => {
    const same = edge({ fromWorkspaceId: "ws-acme", toWorkspaceId: "ws-acme" });
    expect(fleetMessages([same], new Set(["workspace:ws-acme"]))).toEqual([]);
  });

  it("carries the direction through, so a reply is coloured as one", () => {
    const [message] = fleetMessages([edge({ direction: "reply" })], drawn);
    expect(message!.direction).toBe("reply");
  });
});

describe("projectMessages", () => {
  // The spawned session has swapped once and is drawn under its newest
  // segment. The room's OWN chain (segment-7, segment-8) is deliberately
  // absent: the primary IS the centre (Kafi, 2026-08-24), and an unmapped
  // endpoint anchors there.
  const input = {
    nodeIdBySegmentId: new Map([
      ["spawned-1-old", "session:spawned-1"],
      ["spawned-1", "session:spawned-1"],
    ]),
  };

  it("the room's own thread handing work down draws from the CORE — the primary is the centre", () => {
    const [message] = projectMessages(
      [edge({ fromSessionId: "segment-7", toSessionId: "spawned-1" })],
      input,
    );
    expect(message).toMatchObject({
      fromId: null,
      toId: "session:spawned-1",
      direction: "ask",
    });
  });

  it("finds a conversation by ANY segment of its chain, not just its head", () => {
    // Before this, an arc whose endpoint was a pre-swap segment silently
    // vanished — on the one screen whose job is showing what just happened
    // (2026-08-19 audit, A5-10).
    const [message] = projectMessages(
      [edge({ fromSessionId: "segment-7", toSessionId: "spawned-1-old" })],
      input,
    );
    expect(message).toMatchObject({
      fromId: null,
      toId: "session:spawned-1",
    });
  });

  it("a reply with no target session comes home to the core — the centre IS the requester's thread", () => {
    const [message] = projectMessages(
      [
        edge({
          direction: "reply",
          fromSessionId: "spawned-1",
          toSessionId: null,
          toWorkspaceId: "ws-acme",
        }),
      ],
      input,
    );
    expect(message).toMatchObject({
      fromId: "session:spawned-1",
      toId: null,
      direction: "reply",
    });
  });

  it("never draws a conversation talking to its own earlier segment", () => {
    expect(
      projectMessages(
        [edge({ fromSessionId: "spawned-1-old", toSessionId: "spawned-1" })],
        input,
      ),
    ).toEqual([]);
  });

  it("the primary's own segment-to-segment chatter stays off the stage — both ends are the core", () => {
    expect(
      projectMessages(
        [edge({ fromSessionId: "segment-7", toSessionId: "segment-8" })],
        input,
      ),
    ).toEqual([]);
  });

  it("drops a message between two conversations this room does not show", () => {
    expect(
      projectMessages(
        [edge({ fromSessionId: "stranger-a", toSessionId: "stranger-b" })],
        input,
      ),
    ).toEqual([]);
  });
});
