// The rival-site study as the wizard holds it — one entry per site, keyed by
// the cleaned host, moving loading → ready | failed. Failure is a state the
// screen SAYS, never a blank.

export type RivalStudyOutcome =
  | { state: "loading" }
  | { state: "failed" }
  | {
      state: "ready";
      whatTheyDo: string[];
      leaveOut: string[];
      magic: { title: string; why: string }[];
    };

/** "https://OpenTable.com/" → "opentable.com" — the tab label and study key. */
export function cleanSiteName(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}
