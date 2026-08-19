import { workspaceColorSlot } from "@vynel/ui";

/** The one rule for a workspace's accent, as a CSS colour: the hand-picked
 *  hex when set, else the chosen palette slot, else the name-derived slot.
 *  Every surface that paints a workspace (tree icon, chat chip, rail) reads
 *  it from here, so a custom colour shows up everywhere at once. */
export function workspaceAccentCss(
  customization: { colorSlot: number | null; customColor: string | null } | null,
  workspaceName: string,
): string {
  if (customization?.customColor) return customization.customColor;
  return `var(--ws-${customization?.colorSlot ?? workspaceColorSlot(workspaceName)})`;
}

/** The conversation (persona) icon's colour: its own pick when it has one,
 *  else it follows the workspace accent — one persona, one tint. */
export function personaAccentCss(
  customization: {
    colorSlot: number | null;
    customColor: string | null;
    personaColorSlot: number | null;
    personaCustomColor: string | null;
  } | null,
  workspaceName: string,
): string {
  if (customization?.personaCustomColor) return customization.personaCustomColor;
  if (customization?.personaColorSlot) return `var(--ws-${customization.personaColorSlot})`;
  return workspaceAccentCss(customization, workspaceName);
}
