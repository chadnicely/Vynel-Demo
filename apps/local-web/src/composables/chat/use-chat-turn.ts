import { computed, onScopeDispose, shallowRef, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import type {
  ChatSessionResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import { useVynel } from "../use-vynel.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { streamChatTurnEvents } from "./chat-turn-stream.js";
import type { TurnAttachmentInput } from "./turn-attachments.js";
import type { ComposerSettings } from "./use-session-settings.js";
import {
  applyChatTurnEvent,
  createActiveTurnView,
} from "./active-turn-view.js";
import type { ActiveTurnView } from "./active-turn-view.js";
import { sessionKeys } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";
import { workspaceKeys } from "../workspaces/workspace-keys.js";
import {
  invalidateWorkViews,
  isWorkMutatingToolName,
} from "./work-view-invalidation.js";

// A continue-mode workspace turn parked behind a running delegated task leads
// with the `turn-queued` transport sentinel (B3 — the session-turn precedent);
// it is not a ChatTurnEvent kind, so the decoded stream widens at the boundary.
// The queued sentinel names WHY the turn waits: the conversation's own context
// swap ("patching context") or a running task ("working on a task").
export type TurnQueuedReason = "busy" | "context-patching";
type ChatTurnStreamEvent =
  | ChatTurnEvent
  | { kind: "turn-queued"; reason?: TurnQueuedReason };

// Drives one live turn against the real SSE stream. Each ChatTurnEvent folds
// into the active-turn view (transport-blind — the same pure fold the parser
// tests cover); once the server-persisted turn ends, history reconciles by
// invalidation (letterman rule). Approvals are decided out-of-band through the
// approvals API and the stream reflects the resolution, so this engine only
// streams and interrupts.
//
// THE DETACH (live-channel slice 4): the origin stream is an HTTP connection
// held for the turn's whole life — the last per-window user of the browser's
// six-connection pool. Once the thread's standing watch (the window's one live
// socket) has the same turn folding, this engine DETACHES: it aborts its
// stream (client abort only — the server keeps running the turn, exactly as a
// tab switch has always done), clears its overlay, and the watch renders the
// rest — the send becomes a request. `detachWhen` is the host's word that the
// shared fold has the turn; omitted = hold the stream to the end (a host with
// no watch keeps the origin-stream contract unchanged).
export function useChatTurn(options: {
  scope: () => SessionScope;
  /** This surface speaks INTO the voice thread (the Voice chat panel): every
   *  send carries `voice: true`, so the server runs it on the spoken twin
   *  conversation with the speak steering — typed messages behave like
   *  spoken ones (the reply speaks aloud when the daemon is up). */
  voice?: boolean;
  onSessionCreated?: (session: ChatSessionResponse) => void;
  /** True once the shared live fold renders this turn (use-watched-turn's
   *  `hasSharedFold`) — the origin stream may detach. Read reactively. */
  detachWhen?: () => boolean;
}) {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  const activity = useActivityStore();

  const view = shallowRef<ActiveTurnView | null>(null);
  /** Parked behind a delegated run on this workspace (the B3 queued sentinel)
   *  — the composer says "queued" instead of looking frozen. */
  const isQueuedBehindTask = shallowRef(false);
  /** WHY it is parked — the sentinel's reason ('busy' when an older server
   *  omits it); the note reads "patching context" vs "working on a task". */
  const queuedReason = shallowRef<TurnQueuedReason | null>(null);
  /** The session the in-flight turn renders into — known up front for a resume/
   *  continue, or learned from `session-created` for a fresh conversation. */
  const activeSessionId = shallowRef<string | null>(null);
  /** True when the in-flight turn was sent from the CONTINUOUS thread — the
   *  overlay-visibility resolver keys on the turn's ORIGIN, never on a live
   *  query value that can change mid-turn (`visible-active-turn.ts`). */
  const startedContinuous = shallowRef(false);
  /** The last turn's failure, kept AFTER the overlay tears down — the overlay's
   *  own error note lives milliseconds before settle wipes it (the silent-vanish
   *  bug). Cleared on the next send. */
  const errorText = shallowRef<string | null>(null);
  let abortController: AbortController | null = null;
  // Tab switches re-key the RouterView with no KeepAlive — without this, the
  // orphaned reader kept draining from a dead view, retargeting the old tab's
  // shell and firing global invalidations for the rest of the turn. Client
  // abort only: the SERVER turn keeps running (rows persist per chunk) and the
  // activity feed reports it as a background turn until it settles.
  let isDisposed = false;
  onScopeDispose(() => {
    isDisposed = true;
    abortController?.abort();
  });

  const isStreaming = computed(
    () => view.value !== null && view.value.status === "streaming",
  );
  /** The origin stream handed this turn to the shared watch (see the header)
   *  — set for the rest of that turn; the next send clears it. */
  const isDetached = shallowRef(false);

  function ingest(event: ChatTurnEvent) {
    if (!view.value) return;
    view.value = applyChatTurnEvent(view.value, event);
    // A continuation after a checkpoint resumes the head its swap produced —
    // its user row names that segment, and Stop must target it.
    if (event.kind === "user-message-persisted") {
      activeSessionId.value = event.message.sessionId;
    }
    if (event.kind === "session-created") {
      activeSessionId.value = event.session.id;
      options.onSessionCreated?.(event.session);
      // A fresh conversation appears in the Sessions library mid-turn — the
      // full sessionKeys.all reconcile still runs once the turn settles.
      void queryClient.invalidateQueries({ queryKey: sessionKeys.overview() });
    }
    // The assistant just wrote the task list or the step dock — refresh them
    // NOW so the dock ticks while the turn is still running, not after it.
    if (
      event.kind === "tool-call-completed" &&
      isWorkMutatingToolName(event.toolCall.toolName)
    ) {
      void invalidateWorkViews(queryClient);
    }
  }

  async function startTurn(input: {
    sessionId: string | null;
    isContinuous: boolean;
    userText: string;
    attachments?: TurnAttachmentInput[];
    /** The composer settings at send time (use-session-settings values) —
     *  what the user SAW is what the turn runs with, and the server's
     *  write-through persists them onto the session row. */
    settings: ComposerSettings;
  }) {
    if (isStreaming.value) return;

    const scope = options.scope();
    view.value = createActiveTurnView();
    activeSessionId.value = input.sessionId;
    startedContinuous.value = input.isContinuous;
    errorText.value = null;
    isQueuedBehindTask.value = false;
    queuedReason.value = null;
    isDetached.value = false;
    activity.turnStarted();
    const controller = new AbortController();
    abortController = controller;

    // The handoff watcher: once the SERVER has taken the turn (its first frame
    // arrived — never before, or the abort would cancel the send itself) AND
    // the host says the shared fold has it, abort the origin stream. Created
    // per turn and stopped in the finally — never left behind.
    let detachedForWatch = false;
    const serverHasTurn = shallowRef(false);
    const stopDetachWatch =
      options.detachWhen === undefined
        ? () => {}
        : watch(
            () => serverHasTurn.value && options.detachWhen?.() === true,
            (ready) => {
              if (!ready || detachedForWatch) return;
              detachedForWatch = true;
              controller.abort();
            },
          );

    try {
      const stream = streamChatTurnEvents(vynel, {
        scope,
        ...(options.voice === true ? { voice: true } : {}),
        userMessageText: input.userText,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        model: input.settings.modelId,
        // Both scopes carry the composer's session mode — a global turn's mode also
        // governs any delegation the brain enqueues (surface-up step 1).
        mode: input.settings.mode,
        thinkingEffort: input.settings.thinkingEffort,
        autoBuildout: input.settings.autoBuildout,
        signal: abortController.signal,
        // Global root manages its own thread. A workspace turn continues its
        // primary, resumes a picked session, or starts fresh.
        ...(scope.kind === "workspace"
          ? input.isContinuous
            ? { continueRoot: true }
            : input.sessionId !== null
              ? { resumeSessionId: input.sessionId }
              : {}
          : {}),
      });
      for await (const event of stream as AsyncIterable<ChatTurnStreamEvent>) {
        // Parked behind a delegated run on this workspace — a transport
        // sentinel, never folded; the flag lets the composer say "queued"
        // instead of looking frozen (the sidebar's workspace thread shows it).
        if (event.kind === "turn-queued") {
          isQueuedBehindTask.value = true;
          queuedReason.value = event.reason ?? "busy";
          continue;
        }
        isQueuedBehindTask.value = false;
        queuedReason.value = null;
        ingest(event);
        // Any real frame means the server owns the turn now (its user row is
        // persisted; a fresh session has its id) — the handoff may happen.
        if (activeSessionId.value !== null) serverHasTurn.value = true;
      }
      // The stream closed with NO terminal frame at all — a server crash
      // mid-turn used to end here looking exactly like success, pinning
      // "working" forever. A stream the server ENDED deliberately
      // (`turn-stream-ended`, hasEnded) is not a drop.
      if (
        !detachedForWatch &&
        view.value !== null &&
        view.value.status === "streaming" &&
        !view.value.hasEnded
      ) {
        settleFailedTurn(
          new Error(
            "The connection to the assistant dropped mid-turn — anything already produced is in the transcript.",
          ),
        );
      }
    } catch (error) {
      // The detach's own abort is not a failure — the shared fold owns the
      // turn from here (nothing to settle locally).
      if (!detachedForWatch) settleFailedTurn(error);
    } finally {
      stopDetachWatch();
      activity.turnEnded();
      abortController = null;
    }

    // A disposed instance (tab switch mid-turn) stops here: no error note, no
    // invalidation storm from a dead view — the activity feed settles history
    // when the server turn ends.
    if (isDisposed) return;

    // Detached: the watch renders the rest of the turn and the feed's
    // turn-ended settles history; this engine only clears its overlay. The
    // session id stays for Stop (the server interrupt needs it).
    if (detachedForWatch) {
      isDetached.value = true;
      view.value = null;
      return;
    }

    // Keep the failure visible past the overlay teardown below.
    if (view.value?.status === "errored" && view.value.error !== null) {
      errorText.value = view.value.error.message;
    }

    // The server persisted the turn — reconcile every session view by refetch.
    // BOUNDED: a hung refetch must not strand the overlay (and the send queue
    // behind it) forever; past the deadline the overlay clears and the refetch
    // finishes in the background.
    await Promise.race([
      queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    // The turn may have written tasks or steps through its own tools — the
    // settle used to reconcile only the session views, leaving both stale
    // until something else refetched.
    void invalidateWorkViews(queryClient);
    // A global (brain) turn can create a workspace via register_workspace —
    // refresh the list so a newly created one appears without a manual refetch.
    if (scope.kind === "global") {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    }
    view.value = null;
    activeSessionId.value = null;
  }

  // A dropped or aborted stream still has to settle the view. An abort is the
  // user's interrupt; anything else surfaces as a turn error.
  function settleFailedTurn(error: unknown) {
    const sessionId = activeSessionId.value ?? "";
    if (isAbortError(error)) {
      ingest({ kind: "session-interrupted", sessionId });
    } else {
      ingest({
        kind: "session-errored",
        sessionId,
        errorCode: "stream-failed",
        errorMessage:
          error instanceof Error ? error.message : "The turn stream failed.",
        isRecoverable: true,
      });
    }
    isQueuedBehindTask.value = false;
    queuedReason.value = null;
    ingest({ kind: "turn-stream-ended" });
  }

  /** Stop the running turn. `displayedSessionId` is the host's thread — the
   *  target when this engine holds no turn of its own (a watched-only turn:
   *  another window's, a schedule's) or has already detached. */
  function interrupt(displayedSessionId: string | null = null) {
    abortController?.abort();
    // Actively stop the server-side turn on BOTH scopes — without the server
    // call the abort only tears down this client's stream while the turn runs
    // on detached to completion. Best-effort — a failed interrupt call is
    // safe to ignore here (the abort already settled the UI).
    const scope = options.scope();
    const sessionId = activeSessionId.value ?? displayedSessionId;
    if (scope.kind === "workspace" && sessionId !== null) {
      void vynel.chat
        .interruptSession(scope.workspaceId, sessionId)
        .catch(() => undefined);
    } else if (scope.kind === "global") {
      // BY IDENTITY, not by scope: the Voice chat panel is a `global`-scope
      // surface speaking into the SPOKEN thread, so a scope-shaped Stop
      // interrupted the typed thread instead — killing a concurrent global
      // turn while the voice turn ran on. The server owner-checks the id
      // against a global-or-voice chain; with none it falls back to the
      // global head, as before.
      void vynel.root
        .interruptTurn(sessionId === null ? {} : { sessionId })
        .catch(() => undefined);
    }
  }

  return {
    view,
    activeSessionId,
    startedContinuous,
    isStreaming,
    isDetached,
    isQueuedBehindTask,
    queuedReason,
    errorText,
    startTurn,
    interrupt,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
