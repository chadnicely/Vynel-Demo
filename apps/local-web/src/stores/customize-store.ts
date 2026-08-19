import { ref } from "vue";
import { defineStore } from "pinia";
import type { VynelClient } from "@vynel/sdk";
import { SdkError } from "@vynel/sdk";
import type { TreeLayoutResponse } from "@vynel/contracts/customization/customization-http";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";
import {
  HEX_COLOR,
  MENU_GROUP_LABEL_MAX,
  defaultCustomization,
  fromWire,
  readDirtyScopes,
  readLocalTreeLayout,
  readStored,
  readTreeLayoutDirty,
  writeDirty,
  writeLocalCache,
  type ScopeCustomization,
} from "./customize-store-codec.js";

export {
  GLOBAL_SCOPE_KEY,
  defaultCustomization,
  type ScopeCustomization,
  type WorkspaceMenuEntry,
  type WorkspaceMenuGroup,
} from "./customize-store-codec.js";

// Per-SCOPE look-and-menu customization: the two icons and their colours,
// and the sidebar layout — which sections show, in what order, under which
// (fully custom) groups — plus the tree's positions. A scope key is a
// workspaceId or GLOBAL_SCOPE_KEY. Purely presentational: hiding a menu never
// touches the feature's capability or the agent's tools. The DB is the home
// (Kafi, 2026-08-19): pulled once at boot, autosaved whole-scope on a short
// debounce; localStorage is a boot cache + the one-time carry-over source.
// The persona NAME is a real workspace field and saves through
// workspaces.update instead.

const PUSH_DEBOUNCE_MS = 400;

export type CustomizeSaveState = "idle" | "saving" | "saved" | "error";

// The DB is the home (Kafi, 2026-08-19); localStorage is a boot cache and the
// one-time carry-over source for what was arranged before the DB existed.
export const useCustomizeStore = defineStore("customize", () => {
    const byWorkspace = ref<Record<string, ScopeCustomization>>(readStored());
    const treeLayout = ref<TreeLayoutResponse | null>(readLocalTreeLayout());
    const saveState = ref<CustomizeSaveState>("idle");
    const lastSaveError = ref<string | null>(null);

    // ── Server sync ──
    let client: VynelClient | null = null;
    const dirtyScopes = readDirtyScopes();
    let treeLayoutDirty = readTreeLayoutDirty();
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    // Every mutation bumps its scope's generation; a PUT clears the dirty mark
    // only if nothing changed while it was in flight — an edit made during a
    // save is never lost to that save's completion.
    const scopeGeneration = new Map<string, number>();
    let treeGeneration = 0;
    // One flush at a time; a flush asked for mid-flight runs again after.
    let inFlight: Promise<void> | null = null;
    let runAgain = false;

    function rememberDirty() {
      writeDirty(dirtyScopes, treeLayoutDirty);
    }

    function schedulePush() {
      if (client === null) return;
      if (pushTimer !== null) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        pushTimer = null;
        void flush();
      }, PUSH_DEBOUNCE_MS);
    }

    /** Push every dirty scope + the tree layout now (autosave's debounce end,
     *  a hidden window, or an explicit flush). Serialized: overlapping calls
     *  queue one more run. A failed scope keeps its mark and never blocks the
     *  others; a REJECTED save (4xx — the row can't be stored) drops the mark
     *  and surfaces the reason, so it can't poison every later save. */
    function flush(): Promise<void> {
      if (inFlight !== null) {
        runAgain = true;
        return inFlight;
      }
      inFlight = flushOnce().finally(() => {
        inFlight = null;
        if (runAgain) {
          runAgain = false;
          void flush();
        }
      });
      return inFlight;
    }

    async function flushOnce(): Promise<void> {
      if (client === null) return;
      const scopes = [...dirtyScopes];
      const pushTree = treeLayoutDirty;
      if (scopes.length === 0 && !pushTree) return;
      saveState.value = "saving";
      let failure: string | null = null;
      for (const scopeKey of scopes) {
        // A dirty mark with no local row (a corrupt cache) has nothing to say —
        // pushing the default would overwrite the server's real row.
        const config = byWorkspace.value[scopeKey];
        if (config === undefined) {
          dirtyScopes.delete(scopeKey);
          continue;
        }
        const generation = scopeGeneration.get(scopeKey) ?? 0;
        try {
          await client.customizations.saveScope(scopeKey, config);
          if ((scopeGeneration.get(scopeKey) ?? 0) === generation) dirtyScopes.delete(scopeKey);
        } catch (error) {
          failure = error instanceof Error ? error.message : "Couldn't save your changes.";
          if (error instanceof SdkError && error.status >= 400 && error.status < 500) {
            dirtyScopes.delete(scopeKey);
          }
        }
      }
      if (pushTree && treeLayout.value !== null) {
        const generation = treeGeneration;
        try {
          await client.customizations.saveTreeLayout(treeLayout.value);
          if (treeGeneration === generation) treeLayoutDirty = false;
        } catch (error) {
          failure = error instanceof Error ? error.message : "Couldn't save the tree layout.";
          if (error instanceof SdkError && error.status >= 400 && error.status < 500) {
            treeLayoutDirty = false;
          }
        }
      }
      rememberDirty();
      saveState.value = failure === null ? "saved" : "error";
      lastSaveError.value = failure;
    }

    /** Boot (and every return to the window): the server's rows win; a scope
     *  only this browser knows, or one still dirty from a closed window, is
     *  pushed up. Idempotent, and it never rejects — a boot with the engine
     *  down leaves the cache in force and says so in `saveState`. */
    async function hydrate(vynel: VynelClient): Promise<void> {
      client = vynel;
      try {
        const remote = await vynel.customizations.list();
        const remoteKeys = new Set<string>();
        for (const scope of remote.scopes) {
          remoteKeys.add(scope.scopeKey);
          if (!dirtyScopes.has(scope.scopeKey)) byWorkspace.value[scope.scopeKey] = fromWire(scope);
        }
        for (const scopeKey of Object.keys(byWorkspace.value)) {
          if (!remoteKeys.has(scopeKey)) dirtyScopes.add(scopeKey);
        }
        if (remote.treeLayout !== null && !treeLayoutDirty) {
          treeLayout.value = remote.treeLayout;
        } else if (treeLayout.value !== null) {
          treeLayoutDirty = true;
        }
        writeLocalCache(byWorkspace.value, treeLayout.value);
        rememberDirty();
      } catch (error) {
        saveState.value = "error";
        lastSaveError.value =
          error instanceof Error ? error.message : "Couldn't load your customizations.";
        return;
      }
      await flush();
    }

    /** Every mutation lands here: cache locally, mark the scope, autosave. */
    function persist(scopeKey: string) {
      scopeGeneration.set(scopeKey, (scopeGeneration.get(scopeKey) ?? 0) + 1);
      dirtyScopes.add(scopeKey);
      rememberDirty();
      writeLocalCache(byWorkspace.value, treeLayout.value);
      schedulePush();
    }

    function setTreeLayout(layout: TreeLayoutResponse) {
      treeLayout.value = layout;
      treeGeneration += 1;
      treeLayoutDirty = true;
      rememberDirty();
      writeLocalCache(byWorkspace.value, treeLayout.value);
      schedulePush();
    }

    /** The customization in force — stored, or the catalog default. */
    function customizationFor(workspaceId: string): ScopeCustomization {
      return byWorkspace.value[workspaceId] ?? defaultCustomization();
    }

    /** True when the scope differs from the catalog default (a server row
     *  equal to the default is not a customization). */
    function isCustomized(workspaceId: string): boolean {
      const stored = byWorkspace.value[workspaceId];
      return stored !== undefined && JSON.stringify(stored) !== JSON.stringify(defaultCustomization());
    }

    /** Mutations copy-on-write the default so an untouched workspace never
     *  occupies storage. */
    function ensure(workspaceId: string): ScopeCustomization {
      byWorkspace.value[workspaceId] ??= defaultCustomization();
      return byWorkspace.value[workspaceId];
    }

    // Slot and custom colour are one choice: picking either clears the other.
    function setColorSlot(workspaceId: string, colorSlot: number | null) {
      const config = ensure(workspaceId);
      config.colorSlot = colorSlot;
      config.customColor = null;
      persist(workspaceId);
    }

    function setCustomColor(workspaceId: string, hex: string) {
      if (!HEX_COLOR.test(hex)) return;
      const config = ensure(workspaceId);
      config.customColor = hex.toLowerCase();
      config.colorSlot = null;
      persist(workspaceId);
    }

    function setPersonaColorSlot(workspaceId: string, colorSlot: number | null) {
      const config = ensure(workspaceId);
      config.personaColorSlot = colorSlot;
      config.personaCustomColor = null;
      persist(workspaceId);
    }

    function setPersonaCustomColor(workspaceId: string, hex: string) {
      if (!HEX_COLOR.test(hex)) return;
      const config = ensure(workspaceId);
      config.personaCustomColor = hex.toLowerCase();
      config.personaColorSlot = null;
      persist(workspaceId);
    }

    function setPersonaImage(workspaceId: string, dataUrl: string | null) {
      ensure(workspaceId).personaImage = dataUrl;
      persist(workspaceId);
    }

    function setWorkspaceImage(workspaceId: string, dataUrl: string | null) {
      ensure(workspaceId).workspaceImage = dataUrl;
      persist(workspaceId);
    }

    function setHidden(
      workspaceId: string,
      sectionId: WorkspaceSectionId,
      isHidden: boolean,
    ) {
      const entry = ensure(workspaceId).entries.find(
        (candidate) => candidate.sectionId === sectionId,
      );
      if (entry === undefined) return;
      entry.isHidden = isHidden;
      persist(workspaceId);
    }

    function setGroup(
      workspaceId: string,
      sectionId: WorkspaceSectionId,
      groupId: string | null,
    ) {
      const config = ensure(workspaceId);
      const entry = config.entries.find(
        (candidate) => candidate.sectionId === sectionId,
      );
      if (entry === undefined) return;
      if (groupId !== null && !config.groups.some((g) => g.id === groupId))
        return;
      entry.groupId = groupId;
      persist(workspaceId);
    }

    /** `skipSectionIds`: entries the caller's surface doesn't render (the
     *  Global menu's Apps) — the move lands past them, so one click always
     *  crosses one VISIBLE neighbor, never an invisible row. */
    function moveEntry(
      workspaceId: string,
      sectionId: WorkspaceSectionId,
      direction: -1 | 1,
      skipSectionIds: readonly WorkspaceSectionId[] = [],
    ) {
      const entries = ensure(workspaceId).entries;
      const skipped = new Set(skipSectionIds);
      const index = entries.findIndex(
        (candidate) => candidate.sectionId === sectionId,
      );
      if (index === -1) return;
      let target = index + direction;
      while (
        target >= 0 &&
        target < entries.length &&
        skipped.has(entries[target]!.sectionId)
      ) {
        target += direction;
      }
      if (target < 0 || target >= entries.length) return;
      const [entry] = entries.splice(index, 1);
      entries.splice(target, 0, entry!);
      persist(workspaceId);
    }

    function addGroup(workspaceId: string, label: string): string {
      const config = ensure(workspaceId);
      const id = `custom-${crypto.randomUUID()}`;
      config.groups.push({ id, label: label.slice(0, MENU_GROUP_LABEL_MAX) });
      persist(workspaceId);
      return id;
    }

    function renameGroup(workspaceId: string, groupId: string, label: string) {
      const group = ensure(workspaceId).groups.find(
        (candidate) => candidate.id === groupId,
      );
      if (group === undefined) return;
      group.label = label.slice(0, MENU_GROUP_LABEL_MAX);
      persist(workspaceId);
    }

    /** Removing a group strands nobody — its sections become standalone rows. */
    function removeGroup(workspaceId: string, groupId: string) {
      const config = ensure(workspaceId);
      config.groups = config.groups.filter((group) => group.id !== groupId);
      for (const entry of config.entries) {
        if (entry.groupId === groupId) entry.groupId = null;
      }
      persist(workspaceId);
    }

    // Reset writes the default back as the scope's row — the server keeps a
    // row per scope it has ever seen; "default" is a value, not an absence.
    function reset(workspaceId: string) {
      byWorkspace.value[workspaceId] = defaultCustomization();
      persist(workspaceId);
    }

    return {
      byWorkspace,
      treeLayout,
      saveState,
      lastSaveError,
      hydrate,
      flush,
      setTreeLayout,
      customizationFor,
      isCustomized,
      setColorSlot,
      setCustomColor,
      setPersonaColorSlot,
      setPersonaCustomColor,
      setPersonaImage,
      setWorkspaceImage,
      setHidden,
      setGroup,
      moveEntry,
      addGroup,
      renameGroup,
      removeGroup,
      reset,
    };
});
