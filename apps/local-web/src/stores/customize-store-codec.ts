import type {
  ScopeCustomizationResponse,
  TreeLayoutResponse,
} from "@vynel/contracts/customization/customization-http";
import {
  MENU_GROUP_LABELS,
  WORKSPACE_SECTIONS,
  type WorkspaceSectionId,
} from "../components/workspace/workspace-sections.js";

// The SHAPE of a scope's customization + the localStorage codec the store
// reads at boot and writes as a cache. The DB is the home; these keys are a
// boot cache and the one-time carry-over source for what was arranged before
// the DB existed. Pure — no store, no client.

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

export const STORAGE_KEY = "vynel.customize";
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
 *  no longer exist drop out, sections the catalog gained since the save slot
 *  in at their CATALOG position with their catalog group (visible — never
 *  silently hidden; before 2026-08-24 they appended ungrouped at the end,
 *  which put every new section below Marketplace on existing installs), and
 *  a dangling group ref degrades to standalone. The user's own ordering of
 *  the sections they already had is never reshuffled — a new id only slots
 *  in relative to its catalog neighbours. */
export function reconcile(stored: ScopeCustomization): ScopeCustomization {
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
  const catalogOrder = WORKSPACE_SECTIONS.map((section) => section.id);
  for (const section of WORKSPACE_SECTIONS) {
    if (present.has(section.id)) continue;
    // Before the first stored entry that FOLLOWS it in the catalog (walking
    // catalog order, an earlier-inserted new id is already in `entries`, so
    // two new neighbours keep their catalog order too); nothing follows =
    // append. The catalog group applies only if the scope still has it.
    const successorIds = new Set<string>(
      catalogOrder.slice(catalogOrder.indexOf(section.id) + 1),
    );
    const insertAt = entries.findIndex((entry) => successorIds.has(entry.sectionId));
    const entry = {
      sectionId: section.id,
      groupId: section.group !== null && groupIds.has(section.group) ? section.group : null,
      isHidden: false,
    };
    if (insertAt === -1) entries.push(entry);
    else entries.splice(insertAt, 0, entry);
    present.add(section.id);
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
export function readStored(): Record<string, ScopeCustomization> {
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
export const DIRTY_KEY = "vynel.customize.dirty";
export const TREE_LAYOUT_KEY = "vynel.tree.order";

export function readDirtyScopes(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DIRTY_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

export function readLocalTreeLayout(): TreeLayoutResponse | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TREE_LAYOUT_KEY) ?? "null");
    if (parsed === null || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<TreeLayoutResponse>;
    if (!Array.isArray(candidate.groups) || typeof candidate.workspaces !== "object" || candidate.workspaces === null) return null;
    const workspaces: Record<string, string[]> = {};
    for (const [key, ids] of Object.entries(candidate.workspaces)) {
      if (Array.isArray(ids)) workspaces[key] = ids.filter(isNonEmptyString);
    }
    return { groups: candidate.groups.filter(isNonEmptyString), workspaces };
  } catch {
    return null;
  }
}


export function fromWire(scope: ScopeCustomizationResponse): ScopeCustomization {
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


export function writeLocalCache(
  byWorkspace: Record<string, ScopeCustomization>,
  treeLayout: TreeLayoutResponse | null,
): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(byWorkspace));
  if (treeLayout !== null) localStorage.setItem(TREE_LAYOUT_KEY, JSON.stringify(treeLayout));
}

export function writeDirty(scopes: Iterable<string>, treeLayoutDirty: boolean): void {
  localStorage.setItem(DIRTY_KEY, JSON.stringify([...scopes]));
  localStorage.setItem(`${DIRTY_KEY}.tree`, String(treeLayoutDirty));
}

export function readTreeLayoutDirty(): boolean {
  return localStorage.getItem(`${DIRTY_KEY}.tree`) === "true";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The API caps a menu group label at 60 characters — mirrored here so a
 *  long label can never make a scope's save fail forever. */
export const MENU_GROUP_LABEL_MAX = 60;
