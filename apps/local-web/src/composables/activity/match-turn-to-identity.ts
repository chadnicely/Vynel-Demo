import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";

// Does this live turn belong to that thread? ONE predicate for every reader of
// the activity feed (session-hardening D1).
//
// Before this there were three private liveness predicates, and each inferred
// identity from an ABSENCE — "a global-scope turn carrying no session id must
// be the brain's". The voice arc falsified that in a week: the spoken thread
// announced as `scopeKind: 'global'` with no ids at all, so the Global chat
// bound to the voice segment and rendered the private spoken conversation
// (permanently, for a user who had only ever spoken). The wire now carries the
// identity — `scopeKind: 'voice'` and `primarySessionId` on every begin — so
// nothing has to guess.
//
// THE ASYMMETRY, said out loud:
//   - `primary` is THE identity: one continuing conversation, matched by id.
//     Global, voice and spawned threads all bind through it.
//   - `voice` and `workspace` are identities too, because there is exactly one
//     of each per user / per room.
//   - `global` is a FAMILY, not a thread: the root's own turn AND every
//     spawned session and delegation that announces under it. It answers
//     "is anything alive in the global area" (the presence dot) and must
//     NEVER be used to bind a view to a session — that is what let a spawned
//     run be mistaken for the assistant's own thread.
export type TurnIdentity =
  | { kind: "global" }
  | { kind: "voice" }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "primary"; primarySessionId: string };

export function matchTurnToIdentity(
  turn: SessionTurnActivity,
  identity: TurnIdentity,
): boolean {
  const primarySessionId = turn.primarySessionId ?? null;
  switch (identity.kind) {
    case "primary":
      return primarySessionId === identity.primarySessionId;
    case "voice":
      return turn.scopeKind === "voice";
    case "workspace":
      // A room's OWN thread. Sessions spawned inside it announce in the room's
      // scope but name their own continuing identity — they are their own
      // conversations, not the room's.
      return (
        turn.scopeKind === "workspace" &&
        turn.workspaceId === identity.workspaceId &&
        primarySessionId === null
      );
    case "global":
      return turn.scopeKind === "global";
  }
}

/** Every turn on the GLOBAL AREA — the root thread, the spoken thread, and
 *  everything they spawned. Voice counts as a child of global here (D7: the
 *  voice area lives under Global), which is exactly what the shell's presence
 *  dot has always shown; it is only BINDING that must never cross. */
export function isTurnInGlobalArea(turn: SessionTurnActivity): boolean {
  return (
    matchTurnToIdentity(turn, { kind: "global" }) ||
    matchTurnToIdentity(turn, { kind: "voice" })
  );
}
