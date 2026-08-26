import { slugifyFileStem } from "./file-stem-slug.js";

/** A skill's folder name from a typed name — Claude Code skill names cap at 64. */
export function slugifySkillName(raw: string): string {
  return slugifyFileStem(raw, 64);
}
