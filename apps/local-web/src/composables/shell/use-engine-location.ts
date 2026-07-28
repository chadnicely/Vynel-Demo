import { onMounted, ref } from "vue";
import type { Ref } from "vue";

// The engine-location seam (desktop only). WHERE the engine runs is the one
// setting the shell must know BEFORE any daemon exists, so it lives in
// `<app_data>/engine.json` — not the DB — and only the shell can read or
// write it. Driven over the `withGlobalTauri` global like the sibling
// browser/window seams: no Tauri npm dependency, and in a plain browser
// (dev via Vite) `isAvailable` is false so the UI can say so honestly
// instead of pretending the switch worked.

export type EngineMode = "local" | "remote";

export interface EngineLocation {
  /** False outside the desktop shell — switching modes is unavailable. */
  readonly isAvailable: boolean;
  readonly mode: Ref<EngineMode>;
  /** Which provisioned server install remote mode connects to. */
  readonly installId: Ref<string | null>;
  readonly isBusy: Ref<boolean>;
  readonly errorMessage: Ref<string | null>;
  /** Persist the choice; it applies on the next launch (restartApp). */
  save(next: { mode: EngineMode; installId?: string | null }): Promise<boolean>;
  restartApp(): Promise<void>;
}

interface TauriCore {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

function findTauriCore(): TauriCore | null {
  const core = (window as { __TAURI__?: { core?: TauriCore } }).__TAURI__?.core;
  return core ?? null;
}

export function useEngineLocation(): EngineLocation {
  const core = findTauriCore();
  const mode = ref<EngineMode>("local");
  const installId = ref<string | null>(null);
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);

  if (core === null) {
    return {
      isAvailable: false,
      mode,
      installId,
      isBusy,
      errorMessage,
      save: () => Promise.resolve(false),
      restartApp: () => Promise.resolve(),
    };
  }

  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  onMounted(() => {
    void (async () => {
      try {
        const config = (await core.invoke("engine_get_config")) as {
          mode?: string;
          installId?: string | null;
        };
        mode.value = config.mode === "remote" ? "remote" : "local";
        installId.value = config.installId ?? null;
      } catch (error) {
        errorMessage.value = describe(error);
      }
    })();
  });

  return {
    isAvailable: true,
    mode,
    installId,
    isBusy,
    errorMessage,
    save: async (next) => {
      isBusy.value = true;
      errorMessage.value = null;
      try {
        await core.invoke("engine_set_config", {
          mode: next.mode,
          installId: next.installId ?? null,
        });
        mode.value = next.mode;
        installId.value = next.installId ?? null;
        return true;
      } catch (error) {
        errorMessage.value = describe(error);
        return false;
      } finally {
        isBusy.value = false;
      }
    },
    restartApp: async () => {
      try {
        await core.invoke("engine_restart_app");
      } catch {
        // A restart tears the webview down mid-call; a rejection here is
        // normal and must not surface as a failure.
      }
    },
  };
}
