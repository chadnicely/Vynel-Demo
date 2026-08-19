import { ref } from "vue";
import { defineStore } from "pinia";
import type { VynelClient } from "@vynel/sdk";
import type {
  ScopeCustomizationResponse,
  TreeLayoutResponse,
} from "@vynel/contracts/customization/customization-http";
import {
  MENU_GROUP_LABELS,
  WORKSPACE_SECTIONS,
  type WorkspaceSectionId,
} from "../components/workspace/workspace-sections.js";

// Per-SCOPE look-and-menu customization (Chad, 2026-08-04): the accent
// color, the persona image, and the sidebar layout — which sections show, in
// what order, under which (fully custom) groups. A scope key is a workspaceId
// or GLOBAL_SCOPE_KEY (the Global menu customizes the same way). Purely
// presentational: hiding a menu never touches the feature's capability or
// the agent's tools. Persisted locally like the rest of the shell's
// preferences; the persona NAME is a real workspace field and saves through
// workspaces.update instead.

/** The Global surface's key in this store — workspace ids are UUIDs, so the
 *  literal can never collide. */
export const GLOBAL_SCOPE_KEY = "global";

export interface WorkspaceMenuGroup {
  id: string;
  label: string;
}

export interface WorkspaceMenuEntry {
  sectionId: WorkspaceSectionId;
  groupId: string | null;
  isHidden: boolean;
}

export interface ScopeCustomization {
  /** A palette slot (`--ws-N`); null = automatic (name-derived) unless a custom colour is set. */
  colorSlot: number | null;
  /** A hand-picked `#rrggbb` accent (Kafi, 2026-08-19) — wins over the slot when set. */
  customColor: string | null;
  /** The conversation (persona) icon's own colour — slot or hex, one choice (Kafi's two-colour model). */
  personaColorSlot: number | null;
  personaCustomColor: string | null;
  /** Data-URL avatar for the persona's conversation icon; null = ClaudeMark. */
  personaImage: string | null;
  /** Data-URL icon for the WORKSPACE itself (author-line chips, hover cards);
   *  null = the name-derived monogram over the accent. */
  workspaceImage: string | null;
  groups: WorkspaceMenuGroup[];
  entries: WorkspaceMenuEntry[];
}

const STORAGE_KEY = "vynel.customize";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const SECTION_IDS = new Set<string>(WORKSPACE_SECTIONS.map((s) => s.id));

export function defaultCustomization(): ScopeCustomization {
  return {
    colorSlot: null,
    customColor: null,
    personaColorSlot: null,
    personaCustomColor: null,
    personaImage: null,
    workspaceImage: null,
    groups: Object.entries(MENU_GROUP_LABELS).map(([id, label]) => ({
      id,
      label,
    })),
    entries: WORKSPACE_SECTIONS.map((section) => ({
      sectionId: section.id,
      groupId: section.group,
      isHidden: false,
    })),
  };
}

/** Rebuild a stored customization against the CURRENT catalog: sections that
 *  no longer exist drop out, sections the catalog gained since the save
 *  append at the end (visible, ungrouped — never silently hidden), and a
 *  dangling group ref degrades to standalone. */
function reconcile(stored: ScopeCustomization): ScopeCustomization {
  const groupIds = new Set(stored.groups.map((group) => group.id));
  const entries = stored.entries
    .filter((entry) => SECTION_IDS.has(entry.sectionId))
    .map((entry) => ({
      ...entry,
      groupId:
        entry.groupId !== null && groupIds.has(entry.groupId)
          ? entry.groupId
          : null,
    }));
  const present = new Set(entries.map((entry) => entry.sectionId));
  for (const section of WORKSPACE_SECTIONS) {
    if (!present.has(section.id))
      entries.push({ sectionId: section.id, groupId: null, isHidden: false });
  }
  return {
    colorSlot: stored.colorSlot,
    customColor: stored.customColor,
    personaColorSlot: stored.personaColorSlot,
    personaCustomColor: stored.personaCustomColor,
    personaImage: stored.personaImage,
    workspaceImage: stored.workspaceImage,
    groups: stored.groups,
    entries,
  };
}

// A corrupt stored value falls back to defaults — losing a layout preference
// is the harmless failure, so no error surfaces.
function readStored(): Record<string, ScopeCustomization> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const result: Record<string, ScopeCustomization> = {};
    for (const [workspaceId, value] of Object.entries(parsed)) {
      const candidate = value as Partial<ScopeCustomization>;
      if (!Array.isArray(candidate.groups) || !Array.isArray(candidate.entries))
        continue;
      result[workspaceId] = reconcile({
        colorSlot:
          typeof candidate.colorSlot === "number" ? candidate.colorSlot : null,
        customColor:
          typeof candidate.customColor === "string" && HEX_COLOR.test(candidate.customColor)
            ? candidate.customColor
            : null,
        personaColorSlot:
          typeof candidate.personaColorSlot === "number" ? candidate.personaColorSlot : null,
        personaCustomColor:
          typeof candidate.personaCustomColor === "string" && HEX_COLOR.test(candidate.personaCustomColor)
            ? candidate.personaCustomColor
            : null,
        personaImage:
          typeof candidate.personaImage === "string"
            ? candidate.personaImage
            : null,
        workspaceImage:
          typeof candidate.workspaceImage === "string"
            ? candidate.workspaceImage
            : null,
        groups: candidate.groups,
        entries: candidate.entries,
      });
    }
    return result;
  } catch {
    return {};
  }
}

// Scopes changed but not yet confirmed by the server survive a closed window
// here, so the next boot pushes them instead of letting the server's older
// row win.
const DIRTY_KEY = "vynel.customize.dirty";
const TREE_LAYOUT_KEY = "vynel.tree.order";
const PUSH_DEBOUNCE_MS = 400;

function readDirtyScopes(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DIRTY_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function readLocalTreeLayout(): TreeLayoutResponse | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TREE_LAYOUT_KEY) ?? "null");
    if (parsed === null || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<TreeLayoutResponse>;
    if (!Array.isArray(candidate.groups) || typeof candidate.workspaces !== "object" || candidate.workspaces === null) return null;
    return { groups: candidate.groups, workspaces: candidate.workspaces };
  } catch {
    return null;
  }
}

function fromWire(scope: ScopeCustomizationResponse): ScopeCustomization {
  return reconcile({
    colorSlot: scope.colorSlot,
    customColor: scope.customColor,
    personaColorSlot: scope.personaColorSlot,
    personaCustomColor: scope.personaCustomColor,
    personaImage: scope.personaImage,
    workspaceImage: scope.workspaceImage,
    groups: scope.groups,
    entries: scope.entries as WorkspaceMenuEntry[],
  });
}

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
    let treeLayoutDirty = localStorage.getItem(`${DIRTY_KEY}.tree`) === "true";
    let pushTimer: ReturnType<typeof setTimeout> | null = null;

    function rememberDirty() {
      localStorage.setItem(DIRTY_KEY, JSON.stringify([...dirtyScopes]));
      localStorage.setItem(`${DIRTY_KEY}.tree`, String(treeLayoutDirty));
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
     *  or an explicit flush). Failures keep the scope dirty for the next try. */
    async function flush(): Promise<void> {
      if (client === null) return;
      const scopes = [...dirtyScopes];
      const pushTree = treeLayoutDirty;
      if (scopes.length === 0 && !pushTree) return;
      saveState.value = "saving";
      try {
        for (const scopeKey of scopes) {
          const config = byWorkspace.value[scopeKey] ?? defaultCustomization();
          await client.customizations.saveScope(scopeKey, config);
          dirtyScopes.delete(scopeKey);
          rememberDirty();
        }
        if (pushTree && treeLayout.value !== null) {
          await client.customizations.saveTreeLayout(treeLayout.value);
          treeLayoutDirty = false;
          rememberDirty();
        }
        saveState.value = "saved";
        lastSaveError.value = null;
      } catch (error) {
        saveState.value = "error";
        lastSaveError.value = error instanceof Error ? error.message : "Couldn't save your changes.";
      }
    }

    /** Boot: the server's rows win; a scope only this browser knows (or one
     *  still dirty from a closed window) is pushed up. Idempotent. */
    async function hydrate(vynel: VynelClient): Promise<void> {
      client = vynel;
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
      persistLocal();
      rememberDirty();
      await flush();
    }

    function persistLocal() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(byWorkspace.value));
      if (treeLayout.value !== null) localStorage.setItem(TREE_LAYOUT_KEY, JSON.stringify(treeLayout.value));
    }

    /** Every mutation lands here: cache locally, mark the scope, autosave. */
    function persist(scopeKey: string) {
      dirtyScopes.add(scopeKey);
      rememberDirty();
      persistLocal();
      schedulePush();
    }

    function setTreeLayout(layout: TreeLayoutResponse) {
      treeLayout.value = layout;
      treeLayoutDirty = true;
      rememberDirty();
      persistLocal();
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
      config.groups.push({ id, label });
      persist(workspaceId);
      return id;
    }

    function renameGroup(workspaceId: string, groupId: string, label: string) {
      const group = ensure(workspaceId).groups.find(
        (candidate) => candidate.id === groupId,
      );
      if (group === undefined) return;
      group.label = label;
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
