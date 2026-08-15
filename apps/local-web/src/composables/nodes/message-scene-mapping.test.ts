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
  it("draws room to room when both are on screen", () => {
    const drawn = new Set(["ws-home", "ws-acme"]);
    expect(fleetMessages([edge()], drawn)).toEqual([
      {
        id: "job-1",
        fromId: "ws-home",
        toId: "ws-acme",
        direction: "ask",
        sentAt: Date.parse(AT),
      },
    ]);
  });

  it("an endpoint that is not on screen becomes the core", () => {
    // The global root has no workspace — the message really did come from the
    // centre of this picture.
    const [message] = fleetMessages([edge({ fromWorkspaceId: null })], new Set(["ws-acme"]));
    expect(message).toMatchObject({ fromId: null, toId: "ws-acme" });
  });

  it("drops a message with both ends off screen", () => {
    expect(fleetMessages([edge()], new Set(["ws-other"]))).toEqual([]);
  });

  it("never draws a room talking to itself", () => {
    const same = edge({ fromWorkspaceId: "ws-acme", toWorkspaceId: "ws-acme" });
    expect(fleetMessages([same], new Set(["ws-acme"]))).toEqual([]);
  });

  it("carries the direction through, so a reply is coloured as one", () => {
    const [message] = fleetMessages(
      [edge({ direction: "reply" })],
      new Set(["ws-home", "ws-acme"]),
    );
    expect(message!.direction).toBe("reply");
  });
});

describe("projectMessages", () => {
  const input = {
    projectId: "ws-acme",
    continuingSessionId: "segment-7",
    drawnSessionIds: new Set(["spawned-1"]),
  };

  it("the build handing work to a spawned session", () => {
    const [message] = projectMessages(
      [edge({ fromSessionId: "segment-7", toSessionId: "spawned-1" })],
      input,
    );
    expect(message).toMatchObject({
      fromId: "continuing:ws-acme",
      toId: "session:spawned-1",
      direction: "ask",
    });
  });

  it("a reply with no target session goes to the build — that IS the requester", () => {
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
      toId: "continuing:ws-acme",
      direction: "reply",
    });
  });

  it("a reply addressed to a DIFFERENT room is not this project's build", () => {
    // The workspace-target shortcut must not fire for someone else's room.
    const [message] = projectMessages(
      [
        edge({
          direction: "reply",
          fromSessionId: "spawned-1",
          toSessionId: null,
          toWorkspaceId: "ws-elsewhere",
        }),
      ],
      input,
    );
    expect(message).toMatchObject({ fromId: "session:spawned-1", toId: null });
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
