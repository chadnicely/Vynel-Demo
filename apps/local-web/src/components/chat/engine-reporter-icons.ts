// The web face of the engine's reporter kinds
// (`@vynel/contracts/chat/engine-reporter-labels`): which glyph a row wears
// when VYNEL ITSELF is the author — a background job it relayed for, the
// task list, a schedule, a monitor wake. One glyph per kind, and ONE default
// for an engine row this build cannot classify, so the row never falls back
// to a two-letter monogram of a label that names no one ("BT").

import { markRaw, type Component } from "vue";
import {
  PhAlarm,
  PhBinoculars,
  PhGearSix,
  PhListChecks,
  PhRobot,
} from "@phosphor-icons/vue";
import {
  engineReporterKindOf,
  type EngineReporterKind,
} from "@vynel/contracts/chat/engine-reporter-labels";

// Raw on purpose: these travel inside prop objects (a message row's
// `authorPersona`), and a component Vue makes reactive is overhead it warns about.
const ENGINE_REPORTER_GLYPHS: Record<EngineReporterKind, Component> = {
  "background-task": markRaw(PhGearSix),
  tasks: markRaw(PhListChecks),
  schedule: markRaw(PhAlarm),
  monitor: markRaw(PhBinoculars),
};

const DEFAULT_ENGINE_GLYPH: Component = markRaw(PhRobot);

/** The glyph for a row the ENGINE authored (a system notice, or a relay
 *  wearing an engine label); null when the label names a real persona. Pass
 *  `isEngineRow` for a row already known to be the engine's (a `system`
 *  notice) so an unclassified label still gets the default glyph. */
export function engineReporterGlyph(
  sourceLabel: string | null | undefined,
  options: { isEngineRow?: boolean } = {},
): Component | null {
  const kind = engineReporterKindOf(sourceLabel);
  if (kind !== null) return ENGINE_REPORTER_GLYPHS[kind];
  return options.isEngineRow === true ? DEFAULT_ENGINE_GLYPH : null;
}
