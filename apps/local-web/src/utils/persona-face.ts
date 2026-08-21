import type { ScopeCustomization } from "../stores/customize-store-codec.js";

// The face a scope's persona wears, in ONE place (Kafi, 2026-08-22: "the same
// logo everywhere"). Customize holds two images — the conversation (persona)
// icon and the workspace icon the tree shows. A persona icon set on purpose
// wins; otherwise the workspace's logo is the persona's face too, so a
// workspace that uploaded one logo sees it in the tree, the sidebar card AND
// its replies — never a monogram beside a logo.
export function personaFaceOf(custom: ScopeCustomization | null | undefined): string | null {
  return custom?.personaImage ?? custom?.workspaceImage ?? null;
}
