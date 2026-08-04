// `useLiveDelegationCards` — builds the thread's inline persona-card models
// (persona-sessions B5) from three sources the host already holds, WITHOUT any
// per-card SSE (the deliberate cap on connections):
//   - the in-flight delegations poll  → one card per TASK (queued/working),
//   - the activity feed's server turns → the running turn per card (matched by
//     the per-hop trace key the A8 enrichment stamps),
//   - the narration store              → the current step + recent-steps ring.
// A card EXITS at terminal status (the settled ack/report message rows own the
// story then); the ack while running is detected from the thread's OWN rows —
// an attributed inbound row sharing the running turn's CHAIN key (threadId,
// the A5 settle-match column).

import { computed, type MaybeRefOrGetter, toValue } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import { useInFlightDelegations } from "./use-in-flight-delegations.js";
import {
  delegationPersonaName,
  delegationRowKey,
  delegationTaskState,
  findTurnForDelegation,
} from "./delegation-turn-pairing.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useTurnNarrationStore } from "../../stores/turn-narration-store.js";
import { narrationLabelFor } from "../../components/home/narration-label.js";
import {
  usePersonaResolver,
  type ResolvedPersona,
} from "../personas/resolve-persona.js";

export interface PersonaLiveCardStep {
  label: string;
  isRunning: boolean;
}

export interface PersonaLiveCardModel {
  /** Per-TASK identity: the delegation's own trace key (a session running two
   *  tasks = two cards). */
  key: string;
  partialSessionId: string | null;
  persona: ResolvedPersona;
  taskLabel: string;
  state: "queued" | "working";
  /** The child spoke its ack (an attributed inbound row shares the running
   *  turn's chain key) — the card can say "acknowledged". */
  acked: boolean;
  narration: string | null;
  recentSteps: PersonaLiveCardStep[];
  /** The running turn's true start (the feed's clock) — null while queued. */
  startedAt: string | null;
}

export function useLiveDelegationCards(options: {
  /** The thread's settled rows — the ack detector reads their chain keys. */
  messages: MaybeRefOrGetter<ChatMessageResponse[]>;
  /** Restrict cards to ONE workspace's delegations (the workspace thread's
   *  scope — the old banner's `inFlightDelegationsHere` rule). Omit/null =
   *  the creator's full set (the global thread sees every routed job). */
  onlyWorkspaceId?: MaybeRefOrGetter<string | null>;
}) {
  const inFlightQuery = useInFlightDelegations();
  const activity = useActivityStore();
  const narration = useTurnNarrationStore();
  const { resolvePersona } = usePersonaResolver();

  const cards = computed<PersonaLiveCardModel[]>(() => {
    const scopeWorkspaceId = toValue(options.onlyWorkspaceId) ?? null;
    const delegations = (inFlightQuery.data.value ?? []).filter(
      (delegation) =>
        scopeWorkspaceId === null ||
        delegation.workspaceId === scopeWorkspaceId,
    );
    if (delegations.length === 0) return [];
    const turns = Object.values(activity.serverTurns);
    const messages = toValue(options.messages);

    return delegations.map((delegation, index) => {
      const turn = findTurnForDelegation(turns, delegation);
      const turnNarration =
        turn === undefined
          ? undefined
          : narration.narrationByTurnId[turn.turnId];
      const threadId = turn?.threadId ?? null;
      // "Acknowledged" = the CHILD spoke. A 'global-root' row is the PARENT's
      // own routed-task stamp (the shared pipeline's attribution) — in the
      // TARGET workspace's thread it shares the chain key and would flip the
      // badge the moment the turn starts, before any ack was sent.
      const acked =
        threadId !== null &&
        messages.some(
          (message) =>
            message.role === "user" &&
            message.sourceKind != null &&
            message.sourceKind !== "global-root" &&
            message.threadId === threadId,
        );
      const personaName =
        delegationPersonaName(delegation, turn) ?? delegation.workspaceName;
      return {
        key: delegationRowKey(delegation, index),
        partialSessionId: delegation.partialSessionId,
        persona: resolvePersona({
          name: personaName,
          workspaceId: delegation.workspaceId,
        }),
        taskLabel: delegation.taskLabel,
        state: delegationTaskState(delegation.status),
        acked,
        narration: narrationLabelFor(turnNarration?.current),
        recentSteps: (turnNarration?.recentSteps ?? []).flatMap((step) => {
          const label = narrationLabelFor(step);
          return label === null ? [] : [{ label, isRunning: step.isRunning }];
        }),
        startedAt: turn?.startedAt ?? null,
      };
    });
  });

  return { cards };
}
