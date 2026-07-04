import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";

// Typed by the REAL contract — when `GET /workspaces` lands, these rows are
// replaced by API data and nothing downstream changes shape.
export const demoWorkspaces: WorkspaceResponse[] = [
  {
    id: "demo-ws-marketing",
    userId: "demo-user",
    name: "Marketing site",
    managerName: "Mara",
    kind: "small-business",
    path: "C:\\Users\\you\\Vynel\\marketing-site",
    isArchived: false,
    continueEnabled: true,
    createdAt: "2026-06-20T09:00:00.000Z",
    updatedAt: "2026-07-04T18:30:00.000Z",
    lastAccessedAt: "2026-07-04T18:30:00.000Z",
  },
  {
    id: "demo-ws-bookkeeping",
    userId: "demo-user",
    name: "Bookkeeping",
    managerName: "Otto",
    kind: "small-business",
    path: "C:\\Users\\you\\Vynel\\bookkeeping",
    isArchived: false,
    continueEnabled: true,
    createdAt: "2026-06-22T10:00:00.000Z",
    updatedAt: "2026-07-03T15:10:00.000Z",
    lastAccessedAt: "2026-07-03T15:10:00.000Z",
  },
  {
    id: "demo-ws-research",
    userId: "demo-user",
    name: "Market research",
    managerName: null,
    kind: "project",
    path: "C:\\Users\\you\\Vynel\\market-research",
    isArchived: false,
    continueEnabled: false,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-02T12:00:00.000Z",
    lastAccessedAt: "2026-07-02T12:00:00.000Z",
  },
];
