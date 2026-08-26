import { slugifyFileStem } from "./file-stem-slug.js";

/** A slash command's name from a typed name — kebab per segment, with ":"
 *  kept as the folder separator Claude Code uses (`git:commit` ↔
 *  `git/commit.md`). */
export function slugifyCommandName(raw: string): string {
  return raw
    .replace(/^\/+/, "")
    .split(":")
    .map((segment) => slugifyFileStem(segment, 60))
    .filter((segment) => segment.length > 0)
    .join(":");
}
