import type { SectionScope } from "../../components/sections/section-scope.js";

/** The `{ scope, workspaceId? }` pair the top-level skills doors take, from
 *  the surface a section is viewed on — it IS the scope, never a suggestion. */
export function skillScopeOf(
  surface: SectionScope,
): { scope: "user" } | { scope: "workspace"; workspaceId: string } {
  return surface.kind === "workspace"
    ? { scope: "workspace", workspaceId: surface.workspaceId }
    : { scope: "user" };
}

export function skillSurfaceKey(surface: SectionScope): string {
  return surface.kind === "workspace" ? surface.workspaceId : "user";
}
