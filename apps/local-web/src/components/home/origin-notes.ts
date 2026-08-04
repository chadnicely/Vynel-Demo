// Where a turn came from, in plain words — the ONE home for the origin note
// (the Home live band and the Background roster both wear it).

import type { SessionTurnOrigin } from "@vynel/contracts/chat/session-activity";

export const ORIGIN_NOTES: Record<SessionTurnOrigin, string | null> = {
  web: null,
  voice: "via Voice",
  telegram: "via Telegram",
  discord: "via Discord",
  zoom: "via Zoom",
  schedule: "from a schedule",
  delegation: "working on a task",
};
