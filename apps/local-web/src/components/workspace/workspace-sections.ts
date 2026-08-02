// The workspace drawer's section catalog — shared by the drawer list
// (WorkspaceView) and the per-section panel (WorkspaceSectionPanel).

export type WorkspaceSectionId =
  | "agents"
  | "skills"
  | "rules"
  | "commands"
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

export interface WorkspaceSectionMeta {
  id: WorkspaceSectionId;
  label: string;
  hint: string;
}

// Order is the menu's reading order, and it tells a story: what the assistant
// IS (its Claude-native resources), then what Vynel adds on top — Marketplace
// first, because that's where you go to get more of everything above it.
export const WORKSPACE_SECTIONS: WorkspaceSectionMeta[] = [
  { id: "agents", label: "Agents", hint: "Specialists it can delegate to" },
  {
    id: "skills",
    label: "Skills",
    hint: "What your assistant knows how to do",
  },
  {
    id: "rules",
    label: "Rules",
    hint: "Standing instructions it always follows here",
  },
  {
    id: "commands",
    label: "Commands",
    hint: "Reusable slash commands it can run",
  },
  {
    id: "mcp-servers",
    label: "MCP Servers",
    hint: "Tool servers it can reach — add your own",
  },
  { id: "marketplace", label: "Marketplace", hint: "Add new curated skills" },
  {
    id: "channels",
    label: "Channels",
    hint: "Telegram and other ways to reach it",
  },
  {
    id: "schedules",
    label: "Schedules",
    hint: "Briefings, reminders, and watches",
  },
  {
    id: "tasks",
    label: "Tasks",
    hint: "What it's working through and checking off",
  },
  {
    id: "plans",
    label: "Plans",
    hint: "What each day is for, with its tasks underneath",
  },
  {
    id: "journal",
    label: "Journal",
    hint: "The daily record of what happened",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    hint: "Folders it can read and search",
  },
  { id: "memory", label: "Memory", hint: "What it remembers about your work" },
  {
    id: "notebook",
    label: "Notebook",
    hint: "Playbooks it reads when a task calls for them",
  },
  {
    id: "apps",
    label: "Apps",
    hint: "The apps this project runs — start, stop, watch",
  },
  {
    id: "ssh-servers",
    label: "Servers",
    hint: "The machines it can reach and manage over SSH",
  },
];
