import type {
  ChannelKind,
  ChannelResponse,
} from "@vynel/contracts/channels/channel-http";

// The ONE home for how a channel kind presents everywhere (section rows,
// connect dialog, manage dialog, welcome hero): its name, its one-line
// pitch, and whether connecting it is available yet. A new channel kind
// becomes a catalog entry + a ChannelAdapter — never a per-surface hunt.
// The brand mark itself lives in ChannelBrandIcon.vue (SVG per kind).

export interface ChannelCatalogEntry {
  label: string;
  tagline: string;
  /** Shown under the credential field in the connect dialog. */
  connectHint: string;
  /** False = listed as "coming soon"; the connect dialog won't select it. */
  available: boolean;
}

export const CHANNEL_CATALOG: Record<ChannelKind, ChannelCatalogEntry> = {
  telegram: {
    label: "Telegram",
    tagline: "Two minutes with @BotFather",
    connectHint:
      "In Telegram, message @BotFather → /newbot → paste the token it gives you. It stays on this computer.",
    available: true,
  },
  discord: {
    label: "Discord",
    tagline: "Coming soon",
    connectHint: "",
    available: false,
  },
};

export function isChannelHealthy(channel: ChannelResponse): boolean {
  return channel.connectionStatus === "healthy";
}

/** The status pill a channel row wears: label + its tone classes. */
export function channelStatusPill(channel: ChannelResponse): {
  label: string;
  tone: string;
} {
  if (!channel.isEnabled) return { label: "Paused", tone: "bg-hair text-ink-3" };
  return isChannelHealthy(channel)
    ? { label: "Healthy", tone: "bg-ok/15 text-ok" }
    : { label: "Attention", tone: "bg-gold-soft text-gold" };
}

/** A short human status line: "Connected", or what needs attention. */
export function channelConnectionNote(channel: ChannelResponse): string {
  if (!channel.isEnabled) return "Paused";
  if (isChannelHealthy(channel)) return "Connected";
  return channel.connectionStatusMessage ?? "Needs attention";
}
