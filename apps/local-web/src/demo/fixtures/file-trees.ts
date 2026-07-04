// Demo file trees for the workspace files panel — replaced by the files API
// (path-safe directory listing + read/write) when its routes land. Paths are
// "/"-joined from the root (e.g. "site/pricing.md").

export interface DemoFileNode {
  name: string;
  kind: "directory" | "file";
  children?: DemoFileNode[];
  /** Demo file body — files without one open as an empty page. */
  content?: string;
}

export const demoFileTreesByWorkspaceId: Record<string, DemoFileNode[]> = {
  "demo-ws-marketing": [
    {
      name: "site",
      kind: "directory",
      children: [
        {
          name: "index.md",
          kind: "file",
          content:
            "# Acme Tools\n\nEverything your small team needs to ship work — in one calm place.\n\n- Fast setup, no training\n- Works with the tools you already use\n- Priced for small teams\n\n[See pricing](./pricing.md)\n",
        },
        {
          name: "pricing.md",
          kind: "file",
          content:
            "# Pricing\n\nStarter — $19/mo\nPro — $49/mo\nTeam — $99/mo\n\nAll plans include unlimited projects and email support.\nAnnual billing saves two months.\n",
        },
        {
          name: "landing.md",
          kind: "file",
          content:
            '# Do your best work, calmly\n\n> "We switched in an afternoon and never looked back." — a happy customer on the $39 plan (quote kept for history)\n\nStart free, upgrade when it sticks.\n',
        },
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
        {
          name: "summer-launch.md",
          kind: "file",
          content:
            "# Summer launch\n\nGoal: 500 signups by August.\n\n- [x] Landing page refresh\n- [ ] Newsletter announcement\n- [ ] Partner mentions\n",
        },
        {
          name: "newsletter-july.md",
          kind: "file",
          content:
            "# July newsletter\n\nSubject: The pricing you asked for\n\nDraft due Friday — keep it short, lead with the new Pro price.\n",
        },
      ],
    },
    {
      name: "brand-voice.md",
      kind: "file",
      content:
        '# Brand voice\n\nCalm, plain, confident. We explain, we never hype.\n\nSay "you", not "users". Short sentences. No exclamation marks in product copy.\n',
    },
  ],
  "demo-ws-bookkeeping": [
    {
      name: "invoices",
      kind: "directory",
      children: [
        {
          name: "2026-06",
          kind: "directory",
          children: [
            {
              name: "summary.md",
              kind: "file",
              content:
                "# June summary\n\n14 invoices, all matched.\nTwo duplicates archived (INV-1042, INV-1043).\nTotal received: $12,480.\n",
            },
          ],
        },
        { name: "2026-07", kind: "directory", children: [] },
      ],
    },
    {
      name: "ledger.csv",
      kind: "file",
      content:
        "date,description,amount\n2026-06-02,Hosting,-24.00\n2026-06-10,Client A invoice,3200.00\n2026-06-18,Software subscriptions,-89.00\n2026-06-30,Client B invoice,4150.00\n",
    },
    {
      name: "vat-checklist.md",
      kind: "file",
      content:
        "# VAT filing checklist\n\n- [x] Export June ledger\n- [x] Match invoices\n- [ ] Call the accountant (reminder set)\n- [ ] Submit before the 15th\n",
    },
  ],
  "demo-ws-research": [
    {
      name: "interviews",
      kind: "directory",
      children: [
        {
          name: "customer-01.md",
          kind: "file",
          content:
            '# Interview — bakery owner\n\nPain: invoicing eats her Sunday evenings.\nQuote: "I just want it to tell me what needs my attention."\n',
        },
        {
          name: "customer-02.md",
          kind: "file",
          content:
            "# Interview — freelance designer\n\nPain: forgets follow-ups between projects.\nWants reminders that feel like a colleague, not an alarm.\n",
        },
      ],
    },
    {
      name: "competitor-notes.md",
      kind: "file",
      content:
        "# Competitor notes\n\nMost tools assume a technical user. The gap is trust:\nshow what the assistant did, ask before anything irreversible.\n",
    },
  ],
};
