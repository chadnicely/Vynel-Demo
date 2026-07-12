// The workspace drawer's section catalog — shared by the drawer list
// (WorkspaceView) and the per-section panel (WorkspaceSectionPanel).

export type WorkspaceSectionId =
  | "skills"
  | "channels"
  | "schedules"
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
