import { ref } from "vue";
import { defineStore } from "pinia";
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
  colorSlot: number | null;
  /** Data-URL avatar for the persona's conversation icon; null = ClaudeMark. */
  personaImage: string | null;
  /** Data-URL icon for the WORKSPACE itself (author-line chips, hover cards);
   *  null = the name-derived monogram over the accent. */
  workspaceImage: string | null;
  groups: WorkspaceMenuGroup[];
  entries: WorkspaceMenuEntry[];
}

const STORAGE_KEY = "vynel.customize";

const SECTION_IDS = new Set<string>(WORKSPACE_SECTIONS.map((s) => s.id));

export function defaultCustomization(): ScopeCustomization {
  return {
    colorSlot: null,
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

export const useCustomizeStore = defineStore("customize", () => {
    const byWorkspace = ref<Record<string, ScopeCustomization>>(readStored());

    function persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(byWorkspace.value));
    }

    /** The customization in force — stored, or the catalog default. */
    function customizationFor(workspaceId: string): ScopeCustomization {
      return byWorkspace.value[workspaceId] ?? defaultCustomization();
    }

    function isCustomized(workspaceId: string): boolean {
      return workspaceId in byWorkspace.value;
    }

    /** Mutations copy-on-write the default so an untouched workspace never
     *  occupies storage. */
    function ensure(workspaceId: string): ScopeCustomization {
      byWorkspace.value[workspaceId] ??= defaultCustomization();
      return byWorkspace.value[workspaceId];
    }

    function setColorSlot(workspaceId: string, colorSlot: number | null) {
      ensure(workspaceId).colorSlot = colorSlot;
      persist();
    }

    function setPersonaImage(workspaceId: string, dataUrl: string | null) {
      ensure(workspaceId).personaImage = dataUrl;
      persist();
    }

    function setWorkspaceImage(workspaceId: string, dataUrl: string | null) {
      ensure(workspaceId).workspaceImage = dataUrl;
      persist();
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
      persist();
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
      persist();
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
      persist();
    }

    function addGroup(workspaceId: string, label: string): string {
      const config = ensure(workspaceId);
      const id = `custom-${crypto.randomUUID()}`;
      config.groups.push({ id, label });
      persist();
      return id;
    }

    function renameGroup(workspaceId: string, groupId: string, label: string) {
      const group = ensure(workspaceId).groups.find(
        (candidate) => candidate.id === groupId,
      );
      if (group === undefined) return;
      group.label = label;
      persist();
    }

    /** Removing a group strands nobody — its sections become standalone rows. */
    function removeGroup(workspaceId: string, groupId: string) {
      const config = ensure(workspaceId);
      config.groups = config.groups.filter((group) => group.id !== groupId);
      for (const entry of config.entries) {
        if (entry.groupId === groupId) entry.groupId = null;
      }
      persist();
    }

    function reset(workspaceId: string) {
      delete byWorkspace.value[workspaceId];
      persist();
    }

    return {
      byWorkspace,
      customizationFor,
      isCustomized,
      setColorSlot,
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
