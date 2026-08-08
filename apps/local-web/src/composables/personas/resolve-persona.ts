// `resolvePersona` — ONE reading of "who is this, visually" for the live
// persona surfaces (persona-sessions B5): display name, the customized persona
// image when the user set one for that workspace, else a monogram over the
// workspace accent. `@vynel/ui` stays icon-library-free — this resolver hands
// components a ready image-or-monogram pair, never an icon name to render.

import {
  splitSourceLabel,
  workspaceColorSlot,
  workspaceMonogram,
} from "@vynel/ui";
import { useCustomizeStore } from "../../stores/customize-store.js";

export interface ResolvedPersona {
  name: string;
  /** The user's customized persona image for the workspace — null = monogram. */
  imageUrl: string | null;
  monogram: string;
  /** The accent's custom-property NAME (e.g. `--ws-3`) — consumers
   *  interpolate it inside `var()` themselves. Never a full `var(...)`
   *  reference: the double wrap is invalid CSS and silently untints. */
  accentVar: string;
}

export function usePersonaResolver() {
  const customize = useCustomizeStore();

  /** Resolve a live card's persona: the speaking session/agent/workspace name
   *  plus its visual identity. `workspaceId` keys the customized image; a
   *  session/agent persona without one falls to its monogram. */
  function resolvePersona(input: {
    name: string;
    workspaceId?: string | null;
  }): ResolvedPersona {
    const imageUrl =
      input.workspaceId != null
        ? customize.customizationFor(input.workspaceId).personaImage
        : null;
    return {
      name: input.name,
      imageUrl,
      // A persona-first combined label ("James · Claw Launcher") monograms
      // from its PERSONA part — the separator dot must never land in the
      // avatar ("J·"). The accent keeps hashing the full label: color-slot
      // normalization already resolves it to the workspace segment, so
      // every surface keeps its established tint.
      monogram: workspaceMonogram(splitSourceLabel(input.name).persona),
      accentVar: `--ws-${workspaceColorSlot(input.name)}`,
    };
  }

  return { resolvePersona };
}
