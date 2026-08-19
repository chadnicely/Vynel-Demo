import { computed, type ComputedRef } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import {
  deriveSessionStatus,
  type SessionStatusView,
} from "@vynel/contracts/chat/session-status";
import { useVynel } from "../use-vynel.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { sessionKeys } from "../chat/session-keys.js";
import { liveTurnStartedAtForEntry } from "./use-session-statuses.js";

// The spoken thread's status light (session-hardening D2).
//
// Its own read because the shared `GET /sessions/overview` is ALSO the
// `list_sessions` tool's answer: the voice conversation stays behind the
// cross-session wall — no workspace manager gets its row, its title, or its
// segment ids. What it does NOT get is a status of its own: before this, a
// voice turn that failed lit `problem` nowhere in the app, because the chain
// never entered any overview and so had no status facts at all.
//
// The ladder is unchanged and unduplicated — the same `deriveSessionStatus`
// married with the same `liveTurnStartedAtForEntry` every conversation uses.
// Keyed under `sessionKeys.all`, so the activity feed's turn-end invalidation
// refreshes it with everything else.

export function useVoiceChatStatus(): {
  entry: ComputedRef<SessionsOverviewEntry | null>;
  status: ComputedRef<SessionStatusView | null>;
} {
  const vynel = useVynel();
  const activity = useActivityStore();

  const query = useQuery({
    queryKey: [...sessionKeys.all, "voice-status"],
    queryFn: async () =>
      ((await vynel.root.getVoiceStatus()).entry ??
        null) as SessionsOverviewEntry | null,
  });

  const entry = computed<SessionsOverviewEntry | null>(
    () => query.data.value ?? null,
  );

  const status = computed<SessionStatusView | null>(() =>
    entry.value === null
      ? null
      : deriveSessionStatus(entry.value.statusFacts, {
          liveTurnStartedAt: liveTurnStartedAtForEntry(
            entry.value,
            activity.serverTurns,
          ),
        }),
  );

  return { entry, status };
}
