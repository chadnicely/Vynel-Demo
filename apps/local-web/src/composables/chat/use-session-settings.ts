import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { SessionMode } from "@vynel/session";
import type { ThinkingEffortLevel } from "@vynel/contracts/chat/thinking-effort";
import { useVynel } from "../use-vynel.js";
import { useUiStore } from "../../stores/ui-store.js";
import { sessionKeys } from "./session-keys.js";

// The composer's per-session settings engine — the one home for "what do the
// chips show and where does a change go". Two layers:
//
//   - A SESSION is active (sessionId non-null): values come from the session's
//     persisted settings (`sessions.getSettings`), each null field falling
//     back to the local new-chat default; a change PATCHes the session row
//     (optimistic — the chip never flickers) and touches nothing else.
//   - NO session yet (a fresh conversation): values are the ui-store's
//     localStorage defaults, and a change updates those defaults — the first
//     turn's write-through then stamps them onto the row the turn creates.
//
// The send path reuses the same `values` (AppComposer emits them with the
// send), so what the user SAW is exactly what the turn request carries —
// no PATCH-vs-send race.

/** What the composer chips render and every turn request carries. */
export interface ComposerSettings {
  modelId: string;
  mode: SessionMode;
  thinkingEffort: ThinkingEffortLevel;
  autoBuildout: boolean;
}

export type ComposerSettingsPatch = Partial<ComposerSettings>;

/** The settings routes' wire shape (nullable = never set on this session). */
interface SessionSettingsWire {
  sessionMode: SessionMode | null;
  selectedModel: string | null;
  thinkingEffort: ThinkingEffortLevel | null;
  autoBuildout: boolean | null;
}

function toWirePatch(patch: ComposerSettingsPatch) {
  return {
    ...(patch.mode !== undefined ? { sessionMode: patch.mode } : {}),
    ...(patch.modelId !== undefined ? { selectedModel: patch.modelId } : {}),
    ...(patch.thinkingEffort !== undefined
      ? { thinkingEffort: patch.thinkingEffort }
      : {}),
    ...(patch.autoBuildout !== undefined
      ? { autoBuildout: patch.autoBuildout }
      : {}),
  };
}

export function useSessionSettings(sessionId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const ui = useUiStore();
  const queryClient = useQueryClient();

  const activeSessionId = computed(() => toValue(sessionId));

  const query = useQuery({
    queryKey: computed(() =>
      sessionKeys.settings(activeSessionId.value ?? "none"),
    ),
    queryFn: () =>
      vynel.sessions.getSettings(
        activeSessionId.value!,
      ) as Promise<SessionSettingsWire>,
    enabled: computed(() => activeSessionId.value !== null),
    // Settings change through THIS composable (optimistic cache writes) or the
    // turn write-through (reconciled by the turn-end `sessionKeys.all`
    // invalidation) — a background refetch has nothing new to say.
    staleTime: 60_000,
  });

  /** Effective values: the session's persisted settings, each never-set (null)
   *  field falling back to the local new-chat default. */
  const values = computed<ComposerSettings>(() => {
    const server =
      activeSessionId.value !== null ? query.data.value : undefined;
    return {
      modelId: server?.selectedModel ?? ui.composerModelId,
      mode: server?.sessionMode ?? ui.composerMode,
      thinkingEffort: server?.thinkingEffort ?? ui.composerThinkingEffort,
      autoBuildout: server?.autoBuildout ?? ui.composerAutoBuildout,
    };
  });

  const mutation = useMutation({
    mutationFn: (input: { sessionId: string; patch: ComposerSettingsPatch }) =>
      vynel.sessions.updateSettings(input.sessionId, toWirePatch(input.patch)),
    // The optimistic write already painted the chip; on failure refetch the
    // row's truth so the chip honestly snaps back.
    onError: (_error, input) => {
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.settings(input.sessionId),
      });
    },
  });

  function update(patch: ComposerSettingsPatch): void {
    const id = activeSessionId.value;
    if (id === null) {
      // No session yet — the change updates the new-chat defaults; the first
      // turn's write-through stamps them onto the row it creates.
      if (patch.modelId !== undefined) ui.composerModelId = patch.modelId;
      if (patch.mode !== undefined) ui.composerMode = patch.mode;
      if (patch.thinkingEffort !== undefined)
        ui.composerThinkingEffort = patch.thinkingEffort;
      if (patch.autoBuildout !== undefined)
        ui.composerAutoBuildout = patch.autoBuildout;
      return;
    }
    // Optimistic: paint the chip now, persist behind it.
    queryClient.setQueryData<SessionSettingsWire>(
      sessionKeys.settings(id),
      (previous) => ({
        sessionMode: patch.mode ?? previous?.sessionMode ?? null,
        selectedModel: patch.modelId ?? previous?.selectedModel ?? null,
        thinkingEffort: patch.thinkingEffort ?? previous?.thinkingEffort ?? null,
        autoBuildout: patch.autoBuildout ?? previous?.autoBuildout ?? null,
      }),
    );
    mutation.mutate({ sessionId: id, patch });
  }

  return { values, update };
}
