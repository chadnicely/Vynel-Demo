// The web face of the curated session-icon vocabulary
// (`@vynel/contracts/chat/session-icons`): semantic name → Phosphor glyph,
// the app's one icon language. Unknown or unset resolves to null and the
// badge paints the monogram — the vocabulary can grow server-side without
// ever breaking an older client.

import { markRaw, type Component } from "vue";
import {
  PhBell,
  PhBookOpen,
  PhBug,
  PhCalendarBlank,
  PhChartBar,
  PhChatCircle,
  PhClock,
  PhCode,
  PhCurrencyDollar,
  PhDatabase,
  PhEnvelopeSimple,
  PhFileText,
  PhFlask,
  PhFolder,
  PhGearSix,
  PhGitBranch,
  PhGlobe,
  PhImage,
  PhLightbulb,
  PhLock,
  PhMagnifyingGlass,
  PhPackage,
  PhPaintBrush,
  PhPhone,
  PhRobot,
  PhRocketLaunch,
  PhShieldCheck,
  PhTerminal,
  PhUsersThree,
  PhWrench,
} from "@phosphor-icons/vue";
import {
  isSessionIcon,
  type SessionIcon,
} from "@vynel/contracts/chat/session-icons";

const SESSION_ICON_COMPONENTS: Record<SessionIcon, Component> = {
  mail: PhEnvelopeSimple,
  code: PhCode,
  bug: PhBug,
  web: PhGlobe,
  database: PhDatabase,
  docs: PhFileText,
  chart: PhChartBar,
  calendar: PhCalendarBlank,
  robot: PhRobot,
  build: PhWrench,
  test: PhFlask,
  search: PhMagnifyingGlass,
  chat: PhChatCircle,
  rocket: PhRocketLaunch,
  shield: PhShieldCheck,
  design: PhPaintBrush,
  media: PhImage,
  book: PhBookOpen,
  gear: PhGearSix,
  users: PhUsersThree,
  idea: PhLightbulb,
  folder: PhFolder,
  terminal: PhTerminal,
  git: PhGitBranch,
  lock: PhLock,
  bell: PhBell,
  clock: PhClock,
  package: PhPackage,
  phone: PhPhone,
  money: PhCurrencyDollar,
};

/** The glyph for a session's stored icon name — null (unset or a name this
 *  build doesn't know) means "paint the monogram". Raw on purpose: the glyph
 *  travels inside prop objects (a message row's `authorPersona`), and a
 *  component Vue makes reactive is overhead it warns about. */
export function sessionIconComponent(icon: string | null): Component | null {
  return icon !== null && isSessionIcon(icon)
    ? markRaw(SESSION_ICON_COMPONENTS[icon])
    : null;
}
