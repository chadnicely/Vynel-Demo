// The feature-section catalog — the ONE home for the menu's ids, labels,
// reading order, and group story. The sidebar (AppShell) renders it
// grouped; WorkspaceSectionPanel, WorkspaceView, and the ui-store type
// their section props off WorkspaceSectionId.

export type WorkspaceSectionId =
  | "agents"
  | "skills"
  | "rules"
  | "commands"
  | "tool-policy"
  | "mcp-servers"
  | "marketplace"
  | "channels"
  | "schedules"
  | "tasks"
  | "plans"
  | "journal"
  | "knowledge"
  | "memory"
  | "notebook"
  | "apps"
  | "ssh-servers";

// The expandable sidebar groups, named by Chad (2026-08-04 — this
// deliberately supersedes the earlier "one plain list, no special menus"
// call).
export type MenuGroupId = "toolkit" | "utils" | "context" | "connections";

export const MENU_GROUP_LABELS: Record<MenuGroupId, string> = {
  toolkit: "Toolkit",
  utils: "Utils",
  context: "Context",
  connections: "Connections",
};

export interface WorkspaceSectionMeta {
  id: WorkspaceSectionId;
  label: string;
  hint: string;
  // null → a standalone row outside every group (Marketplace: the store,
  // not a thing you manage — it stays visible with all groups collapsed).
  group: MenuGroupId | null;
}

// Order is the menu's reading order, and it tells a story: what the
// assistant can DO here (toolkit), the running work (utils), what it knows
// and remembers (context), everything it reaches beyond this machine
// (connections) — then Schedules and Marketplace as standalone rows:
// Claude's own time, and the store for more of everything above it.
export const WORKSPACE_SECTIONS: WorkspaceSectionMeta[] = [
  {
    id: "agents",
    label: "Agents",
    hint: "Specialists it can delegate to",
    group: "toolkit",
  },
  {
    id: "skills",
    label: "Skills",
    hint: "What your assistant knows how to do",
    group: "toolkit",
  },
  {
    id: "rules",
    label: "Rules",
    hint: "Standing instructions it always follows here",
    group: "toolkit",
  },
  {
    id: "commands",
    label: "Commands",
    hint: "Reusable slash commands it can run",
    group: "toolkit",
  },
  {
    id: "tool-policy",
    label: "Tool Policy",
    hint: "Which tools it may use, where, and when they card",
    group: "toolkit",
  },
  {
    id: "apps",
    label: "Apps",
    hint: "The apps this project runs — start, stop, watch",
    group: "utils",
  },
  {
    id: "plans",
    label: "Plans",
    hint: "What each day is for, with its tasks underneath",
    group: "utils",
  },
  {
    id: "tasks",
    label: "Tasks",
    hint: "What it's working through and checking off",
    group: "utils",
  },
  {
    id: "memory",
    label: "Memory",
    hint: "What it remembers about your work",
    group: "context",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    hint: "Folders it can read and search",
    group: "context",
  },
  {
    id: "notebook",
    label: "Notebook",
    hint: "Playbooks it reads when a task calls for them",
    group: "context",
  },
  {
    id: "journal",
    label: "Journal",
    hint: "The daily record of what happened",
    group: "context",
  },
  {
    id: "channels",
    label: "Channels",
    hint: "Telegram and other ways to reach it",
    group: "connections",
  },
  {
    id: "ssh-servers",
    label: "Servers",
    hint: "The machines it can reach and manage over SSH",
    group: "connections",
  },
  {
    id: "mcp-servers",
    label: "MCP Servers",
    hint: "Tool servers it can reach — add your own",
    group: "connections",
  },
  {
    id: "schedules",
    label: "Schedules",
    hint: "Briefings, reminders, and watches",
    group: null,
  },
  {
    id: "marketplace",
    label: "Marketplace",
    hint: "Add new curated skills",
    group: null,
  },
];
