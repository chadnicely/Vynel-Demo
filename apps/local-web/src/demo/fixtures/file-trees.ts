// Demo file trees for the workspace files panel — replaced by the files API
// (path-safe directory listing) when its routes land.

export interface DemoFileNode {
  name: string;
  kind: "directory" | "file";
  children?: DemoFileNode[];
}

export const demoFileTreesByWorkspaceId: Record<string, DemoFileNode[]> = {
  "demo-ws-marketing": [
    {
      name: "site",
      kind: "directory",
      children: [
        { name: "index.md", kind: "file" },
        { name: "pricing.md", kind: "file" },
        { name: "landing.md", kind: "file" },
        {
          name: "assets",
          kind: "directory",
          children: [
            { name: "logo.svg", kind: "file" },
            { name: "hero.png", kind: "file" },
          ],
        },
      ],
    },
    {
      name: "campaigns",
      kind: "directory",
      children: [
        { name: "summer-launch.md", kind: "file" },
        { name: "newsletter-july.md", kind: "file" },
      ],
    },
    { name: "brand-voice.md", kind: "file" },
  ],
  "demo-ws-bookkeeping": [
    {
      name: "invoices",
      kind: "directory",
      children: [
        {
          name: "2026-06",
          kind: "directory",
          children: [{ name: "summary.md", kind: "file" }],
        },
        { name: "2026-07", kind: "directory", children: [] },
      ],
    },
    { name: "ledger.csv", kind: "file" },
    { name: "vat-checklist.md", kind: "file" },
  ],
  "demo-ws-research": [
    {
      name: "interviews",
      kind: "directory",
      children: [
        { name: "customer-01.md", kind: "file" },
        { name: "customer-02.md", kind: "file" },
      ],
    },
    { name: "competitor-notes.md", kind: "file" },
  ],
};
