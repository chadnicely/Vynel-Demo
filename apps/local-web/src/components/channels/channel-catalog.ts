import type {
  ChannelKind,
  ChannelResponse,
} from "@vynel/contracts/channels/channel-http";

// The ONE home for how a channel kind presents everywhere (section rows,
// connect dialog, manage dialog, welcome hero): its name, its one-line
// pitch, its credential FORM, and whether connecting it is available yet.
// A new channel kind becomes a catalog entry + a ChannelAdapter — never a
// per-surface hunt. The brand mark itself lives in ChannelBrandIcon.vue.

export interface ChannelCredentialField {
  /** The key inside the opaque botCredentials bag. */
  key: string;
  label: string;
  placeholder?: string;
  /** Render as a password input (never echoed). */
  secret?: boolean;
}

export interface ChannelCatalogEntry {
  label: string;
  tagline: string;
  /** Shown under the credential fields in the connect dialog. */
  connectHint: string;
  /** False = listed as "coming soon"; the connect dialog won't select it. */
  available: boolean;
  /** Seeded into the Name field when this kind is selected. */
  defaultName: string;
  credentialFields: ChannelCredentialField[];
  /** The optional first-allowed-sender input; null = the kind's sender ids
   *  aren't user-knowable upfront (add senders from Manage instead). */
  allowedSenderField: { label: string; placeholder: string; hint: string } | null;
}

export const CHANNEL_CATALOG: Record<ChannelKind, ChannelCatalogEntry> = {
  telegram: {
    label: "Telegram",
    tagline: "Two minutes with @BotFather",
    connectHint:
      "In Telegram, message @BotFather → /newbot → paste the token it gives you. It stays on this computer.",
    available: true,
    defaultName: "My Telegram",
    credentialFields: [
      { key: "botToken", label: "Bot token", placeholder: "123456:ABC-…", secret: true },
    ],
    allowedSenderField: {
      label: "Your Telegram user ID",
      placeholder: "e.g. 123456789",
      hint: "Only allowed senders can talk to Claude. Add yourself now (ask @userinfobot for your ID) or approve senders later.",
    },
  },
  zoom: {
    label: "Zoom",
    tagline: "Team Chat, no public URL needed",
    connectHint:
      "Create a Team Chat app on marketplace.zoom.us with the imchat:bot scope, set its Event Subscription to WebSocket mode, then copy these five values from the app's Credentials and Features pages. They stay on this computer.",
    available: true,
    defaultName: "My Zoom",
    credentialFields: [
      { key: "clientId", label: "Client ID", placeholder: "from App Credentials" },
      { key: "clientSecret", label: "Client secret", secret: true },
      { key: "botJid", label: "Bot JID", placeholder: "…@xmpp.zoom.us" },
      { key: "accountId", label: "Account ID" },
      { key: "subscriptionId", label: "Event subscription ID", placeholder: "from Features → Event Subscriptions" },
    ],
    // Zoom sender JIDs aren't user-knowable upfront — senders are added
    // from the Manage dialog after their first message.
    allowedSenderField: null,
  },
  discord: {
    label: "Discord",
    tagline: "Coming soon",
    connectHint: "",
    available: false,
    defaultName: "My Discord",
    credentialFields: [],
    allowedSenderField: null,
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
