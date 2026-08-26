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
//   - LOCKED (a surface whose server pins its own tier — the hands-free voice
//     thread, D2): there is no third layer. A write would land on whichever of
//     the two above happens to be active, and the "no session" branch is the
//     dangerous one: it rewrites the user's GLOBAL new-chat defaults from a
//     composer that only ever speaks for one thread. So `update` throws.

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

export function useSessionSettings(
  sessionId: MaybeRefOrGetter<string | null>,
  /** A SURFACE's own never-set defaults, sitting BETWEEN the row and the
   *  ui-store fallbacks: the Voice chat panel defaults to the voice tier
   *  (sonnet at low effort) instead of the chat default (Kafi 2026-08-19).
   *  A persisted row value still wins; a chip change still persists. */
  surfaceDefaults?: Partial<Pick<ComposerSettings, "modelId" | "thinkingEffort" | "mode">>,
  options?: {
    /** This surface's settings are PINNED by the server (the voice tier) —
     *  reading them is fine, writing is a bug in the caller. */
    locked?: MaybeRefOrGetter<boolean>;
  },
) {
  const vynel = useVynel();
  const ui = useUiStore();
  const queryClient = useQueryClient();

  const activeSessionId = computed(() => toValue(sessionId));
  const isLocked = computed(() => toValue(options?.locked ?? false));

  const query = useQuery({
    queryKey: computed(() =>
      sessionKeys.settings(activeSessionId.value ?? "none"),
    ),
    // Typed assignment, not a cast — if the generated wire type drifts from
    // SessionSettingsWire, this line fails to compile (drift is caught, never
    // masked).
    queryFn: (): Promise<SessionSettingsWire> =>
      vynel.sessions.getSettings(activeSessionId.value!),
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
      modelId: server?.selectedModel ?? surfaceDefaults?.modelId ?? ui.composerModelId,
      mode: server?.sessionMode ?? surfaceDefaults?.mode ?? ui.composerMode,
      thinkingEffort:
        server?.thinkingEffort ??
        surfaceDefaults?.thinkingEffort ??
        ui.composerThinkingEffort,
      autoBuildout: server?.autoBuildout ?? ui.composerAutoBuildout,
    };
  });

  const SETTINGS_MUTATION_KEY = ["session-settings-update"];
  const mutation = useMutation({
    mutationKey: SETTINGS_MUTATION_KEY,
    mutationFn: (vars: {
      sessionId: string;
      patch: ComposerSettingsPatch;
    }): Promise<SessionSettingsWire> =>
      vynel.sessions.updateSettings(vars.sessionId, toWirePatch(vars.patch)),
    onMutate: async (vars) => {
      // Freeze any in-flight GET first — without this, a stale response
      // resolving after the optimistic paint overwrites the cache with
      // pre-PATCH values and the chip snaps back (review finding).
      await queryClient.cancelQueries({
        queryKey: sessionKeys.settings(vars.sessionId),
      });
      const previous = queryClient.getQueryData<SessionSettingsWire>(
        sessionKeys.settings(vars.sessionId),
      );
      // Optimistic: paint the chip now, persist behind it.
      queryClient.setQueryData<SessionSettingsWire>(
        sessionKeys.settings(vars.sessionId),
        {
          sessionMode: vars.patch.mode ?? previous?.sessionMode ?? null,
          selectedModel: vars.patch.modelId ?? previous?.selectedModel ?? null,
          thinkingEffort:
            vars.patch.thinkingEffort ?? previous?.thinkingEffort ?? null,
          autoBuildout:
            vars.patch.autoBuildout ?? previous?.autoBuildout ?? null,
        },
      );
      return { previous };
    },
    onSuccess: (updated, vars) => {
      // Reconcile with the server's answer — but only when no OTHER settings
      // mutation is still in flight, or a slow first response would revert a
      // faster second chip flip until its own response landed.
      if (
        queryClient.isMutating({ mutationKey: SETTINGS_MUTATION_KEY }) === 1
      ) {
        queryClient.setQueryData(sessionKeys.settings(vars.sessionId), updated);
      }
    },
    onError: (_error, vars, context) => {
      // Roll back to the pre-patch snapshot, then refetch the row's truth so
      // the chip honestly snaps back.
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          sessionKeys.settings(vars.sessionId),
          context.previous,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.settings(vars.sessionId),
      });
    },
  });

  function update(patch: ComposerSettingsPatch): void {
    if (isLocked.value) {
      throw new Error(
        "This conversation's settings are pinned by the server and cannot be changed from the composer.",
      );
    }
    // The MODE is a standing preference, not a per-thread setting (Chad,
    // 2026-08-25): "keep that status until the user changes it again". It has
    // to survive a new chat, a restart, a model change and coming back from a
    // rate limit — all of which land on a session whose row has no mode yet,
    // and so fall back to this default. Writing it here is what makes Auto
    // stay Auto instead of quietly reverting to Ask.
    if (patch.mode !== undefined) ui.composerMode = patch.mode;

    const id = activeSessionId.value;
    if (id === null) {
      // No session yet — the change updates the new-chat defaults; the first
      // turn's write-through stamps them onto the row it creates.
      if (patch.modelId !== undefined) ui.composerModelId = patch.modelId;
      if (patch.thinkingEffort !== undefined)
        ui.composerThinkingEffort = patch.thinkingEffort;
      if (patch.autoBuildout !== undefined)
        ui.composerAutoBuildout = patch.autoBuildout;
      return;
    }
    mutation.mutate({ sessionId: id, patch });
  }

  return { values, update };
}
