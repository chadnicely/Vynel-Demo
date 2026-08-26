import { slugifyFileStem } from "./file-stem-slug.js";

/** A rule's (and an agent's) file name from a typed name — the API slug cap. */
export function slugifyRuleName(raw: string): string {
  return slugifyFileStem(raw, 80);
}
