// The workspace drawer's section catalog — shared by the drawer list
// (WorkspaceView) and the per-section panel (WorkspaceSectionPanel).

export type WorkspaceSectionId =
  | "skills"
  | "channels"
  | "schedules"
  | "tasks"
  | "plans"
  | "journal"
  | "apps"
  | "ssh-servers"
  | "knowledge"
  | "marketplace"
  | "memory"
  | "notebook"
  | "agents";

export interface WorkspaceSectionMeta {
  id: WorkspaceSectionId;
  label: string;
  hint: string;
}

export const WORKSPACE_SECTIONS: WorkspaceSectionMeta[] = [
  {
    id: "skills",
    label: "Skills",
    hint: "What your assistant knows how to do",
  },
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
    id: "apps",
    label: "Apps",
    hint: "The apps this project runs — start, stop, watch",
  },
  {
    id: "ssh-servers",
    label: "Servers",
    hint: "The machines it can reach and manage over SSH",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    hint: "Folders it can read and search",
  },
  { id: "marketplace", label: "Marketplace", hint: "Add new curated skills" },
  { id: "memory", label: "Memory", hint: "What it remembers about your work" },
  {
    id: "notebook",
    label: "Notebook",
    hint: "Playbooks it reads when a task calls for them",
  },
  { id: "agents", label: "Agents", hint: "Specialists it can delegate to" },
];
