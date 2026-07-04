import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";

// Plays a scripted turn as a live ChatTurnEvent stream — the demo stand-in for
// the future SSE reader (`POST /sessions/turn`). The consumer is transport-
// blind: it just receives ChatTurnEvent callbacks, exactly like it will from
// the real stream.

export type DemoTurnStep =
  | { kind: "emit"; delayMs: number; event: ChatTurnEvent }
  | {
      // Pauses the stream on a pending approval, like the real runtime does.
      // The UI resumes it via handle.decideApproval — the same seam that will
      // call `client.approvals.decide` against the real API.
      kind: "approval-gate";
      delayMs: number;
      approvalRequestId: string;
      parentMessageId: string;
      toolName: string;
      toolInput: unknown;
      approved: DemoTurnStep[];
      denied: DemoTurnStep[];
    };

export type DemoApprovalDecision = "approved" | "denied";

export interface DemoTurnHandle {
  /** Resolves when the stream has emitted its final event (ended or interrupted). */
  done: Promise<void>;
  interrupt(): void;
  decideApproval(
    approvalRequestId: string,
    decision: DemoApprovalDecision,
  ): void;
}

interface PlayerState {
  interrupted: boolean;
  pendingDecisions: Map<string, (decision: DemoApprovalDecision) => void>;
  cancelSleep: (() => void) | null;
}

class TurnInterrupted extends Error {
  constructor() {
    super("demo turn interrupted");
  }
}

function sleep(state: PlayerState, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.cancelSleep = null;
      resolve();
    }, ms);
    state.cancelSleep = () => {
      clearTimeout(timer);
      reject(new TurnInterrupted());
    };
  });
}

function awaitDecision(
  state: PlayerState,
  approvalRequestId: string,
): Promise<DemoApprovalDecision> {
  return new Promise((resolve) => {
    state.pendingDecisions.set(approvalRequestId, resolve);
  });
}

export function playDemoTurn(
  sessionId: string,
  steps: DemoTurnStep[],
  onEvent: (event: ChatTurnEvent) => void,
): DemoTurnHandle {
  const state: PlayerState = {
    interrupted: false,
    pendingDecisions: new Map(),
    cancelSleep: null,
  };

  async function walk(sequence: DemoTurnStep[]): Promise<void> {
    for (const step of sequence) {
      if (state.interrupted) throw new TurnInterrupted();
      await sleep(state, step.delayMs);

      if (step.kind === "emit") {
        onEvent(step.event);
        continue;
      }

      onEvent({
        kind: "approval-requested",
        approvalRequestId: step.approvalRequestId,
        parentMessageId: step.parentMessageId,
        toolName: step.toolName,
        toolInput: step.toolInput,
        requestedAt: new Date().toISOString(),
      });
      const decision = await awaitDecision(state, step.approvalRequestId);
      if (state.interrupted) throw new TurnInterrupted();
      onEvent({
        kind: "approval-resolved",
        approvalRequestId: step.approvalRequestId,
        decision: { kind: decision },
        resolvedAt: new Date().toISOString(),
      });
      await walk(decision === "approved" ? step.approved : step.denied);
    }
  }

  const done = walk(steps).catch((error: unknown) => {
    if (error instanceof TurnInterrupted) {
      onEvent({ kind: "session-interrupted", sessionId });
      onEvent({ kind: "turn-stream-ended" });
      return;
    }
    throw error;
  });

  return {
    done,
    interrupt() {
      if (state.interrupted) return;
      state.interrupted = true;
      state.cancelSleep?.();
      // A turn paused on an approval unblocks and lands in the interrupt path.
      for (const resolve of state.pendingDecisions.values()) resolve("denied");
      state.pendingDecisions.clear();
    },
    decideApproval(approvalRequestId, decision) {
      const resolve = state.pendingDecisions.get(approvalRequestId);
      if (!resolve) return;
      state.pendingDecisions.delete(approvalRequestId);
      resolve(decision);
    },
  };
}
