import { MessageSquare, Send } from "lucide-vue-next";
import type {
  ChannelKind,
  ChannelResponse,
} from "@vynel/contracts/channels/channel-http";

// The one home for how a channel row renders across the global-chat surfaces
// (welcome hero + identity bar): its icon and how its connection reads.

export const CHANNEL_ICONS: Record<ChannelKind, typeof Send> = {
  telegram: Send,
  discord: MessageSquare,
};

export function isChannelHealthy(channel: ChannelResponse): boolean {
  return channel.connectionStatus === "healthy";
}

/** A short human status line: "Connected", or what needs attention. */
export function channelConnectionNote(channel: ChannelResponse): string {
  if (isChannelHealthy(channel)) return "Connected";
  return channel.connectionStatusMessage ?? "Needs attention";
}
