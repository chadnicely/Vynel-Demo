import type { ChannelResponse } from "@vynel/contracts/channels/channel-http";
import type { ScheduleResponse } from "@vynel/contracts/schedules/schedule-http";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";
import type { VerifiedSkillDefinition } from "@vynel/contracts/skills/verified-skills/verified-skill-definition";

// Demo rows for the workspace drawer sections + the Home dashboard.
// Typed by (or Pick'ed from) the real contracts so they drift-guard against
// the API the same way the chat fixtures do. Demo-phase only — each section
// swaps to its real SDK namespace when we wire live engagement.

/** The list-row slice of a skill + its per-user install state. */
export type DemoInstalledSkill = Pick<
  VerifiedSkillDefinition,
  | "skillId"
  | "displayName"
  | "oneLineDescription"
  | "category"
  | "iconName"
  | "version"
> & { isEnabled: boolean };

export const demoSkills: DemoInstalledSkill[] = [
  {
    skillId: "email-drafter",
    displayName: "Email Drafter",
    oneLineDescription:
      "Drafts replies in your tone, ready to approve and send.",
    category: "email",
    iconName: "MailPlus",
    version: "1.2.0",
    isEnabled: true,
  },
  {
    skillId: "meeting-notes",
    displayName: "Meeting Notes",
    oneLineDescription:
      "Turns a raw transcript into decisions and action items.",
    category: "notes",
    iconName: "NotebookPen",
    version: "1.0.3",
    isEnabled: true,
  },
  {
    skillId: "invoice-reader",
    displayName: "Invoice Reader",
    oneLineDescription: "Pulls totals, dates, and vendors out of PDF invoices.",
    category: "documents",
    iconName: "ReceiptText",
    version: "0.9.1",
    isEnabled: false,
  },
];

export const demoChannels: ChannelResponse[] = [
  {
    id: "demo-channel-telegram",
    userId: "demo-user",
    workspaceId: null,
    channelKind: "telegram",
    displayName: "Personal Telegram",
    botMetadata: { botUsername: "vynel_assistant_bot" },
    connectionStatus: "healthy",
    connectionStatusMessage: null,
    lastPolledAt: "2026-07-05T03:20:00.000Z",
    lastInboundAt: "2026-07-04T21:14:00.000Z",
    isEnabled: true,
    createdAt: "2026-06-22T10:00:00.000Z",
    updatedAt: "2026-07-05T03:20:00.000Z",
  },
  {
    id: "demo-channel-team",
    userId: "demo-user",
    workspaceId: "demo-ws-marketing",
    channelKind: "telegram",
    displayName: "Marketing updates",
    botMetadata: { botUsername: "vynel_marketing_bot" },
    connectionStatus: "auth-failed",
    connectionStatusMessage: "Bot token revoked — reconnect to resume.",
    lastPolledAt: "2026-07-01T09:00:00.000Z",
    lastInboundAt: null,
    isEnabled: false,
    createdAt: "2026-06-25T12:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
  },
];

export const demoSchedules: ScheduleResponse[] = [
  {
    id: "demo-schedule-briefing",
    userId: "demo-user",
    workspaceId: null,
    templateKind: "morning-briefing",
    scheduleKind: "recurring",
    displayName: "Morning briefing",
    cronExpression: "0 8 * * 1-5",
    timezone: "Asia/Dhaka",
    promptTemplate:
      "Summarize my day: calendar, waiting approvals, overnight activity.",
    destinationKind: "chat-and-channel",
    channelId: "demo-channel-telegram",
    catchUpOnMiss: true,
    isEnabled: true,
    approvalTimeoutMsOverride: null,
    lastFiredAt: "2026-07-04T02:00:00.000Z",
    nextScheduledFireAt: "2026-07-06T02:00:00.000Z",
    createdAt: "2026-06-23T08:00:00.000Z",
    updatedAt: "2026-07-04T02:00:05.000Z",
  },
  {
    id: "demo-schedule-weekly",
    userId: "demo-user",
    workspaceId: "demo-ws-bookkeeping",
    templateKind: "weekly-summary",
    scheduleKind: "recurring",
    displayName: "Weekly finance summary",
    cronExpression: "0 17 * * 5",
    timezone: "Asia/Dhaka",
    promptTemplate: "Summarize the week's invoices and flag anything unusual.",
    destinationKind: "chat-only",
    channelId: null,
    catchUpOnMiss: false,
    isEnabled: true,
    approvalTimeoutMsOverride: null,
    lastFiredAt: "2026-07-03T11:00:00.000Z",
    nextScheduledFireAt: "2026-07-10T11:00:00.000Z",
    createdAt: "2026-06-24T09:00:00.000Z",
    updatedAt: "2026-07-03T11:00:04.000Z",
  },
  {
    id: "demo-schedule-reminder",
    userId: "demo-user",
    workspaceId: null,
    templateKind: "reminder",
    scheduleKind: "one-time",
    displayName: "Call the accountant",
    cronExpression: null,
    timezone: "Asia/Dhaka",
    promptTemplate: "Remind me to call the accountant about the VAT filing.",
    destinationKind: "chat-and-channel",
    channelId: "demo-channel-telegram",
    catchUpOnMiss: true,
    isEnabled: true,
    approvalTimeoutMsOverride: null,
    lastFiredAt: null,
    nextScheduledFireAt: "2026-07-07T04:30:00.000Z",
    createdAt: "2026-07-04T16:00:00.000Z",
    updatedAt: "2026-07-04T16:00:00.000Z",
  },
];

/** No knowledge HTTP contract yet — light demo type, replaced by the SDK's. */
export interface DemoKnowledgeSource {
  id: string;
  displayName: string;
  path: string;
  scope: "workspace" | "global";
  documentCount: number;
  lastIndexedAt: string;
}

export const demoKnowledgeSources: DemoKnowledgeSource[] = [
  {
    id: "demo-knowledge-brand",
    displayName: "Brand guidelines",
    path: "C:\\Users\\you\\Vynel\\marketing-site\\brand",
    scope: "workspace",
    documentCount: 24,
    lastIndexedAt: "2026-07-04T18:00:00.000Z",
  },
  {
    id: "demo-knowledge-personal",
    displayName: "Personal notes",
    path: "C:\\Users\\you\\Documents\\Notes",
    scope: "global",
    documentCount: 132,
    lastIndexedAt: "2026-07-05T01:30:00.000Z",
  },
];

export const demoMarketplaceItems: MarketplaceItem[] = [
  {
    itemId: "demo-item-research",
    skillId: "deep-research",
    publisherTier: "anthropic-official",
    publisherName: "Anthropic",
    publisherUrl: "https://anthropic.com",
    displayName: "Deep Research",
    oneLineDescription: "Multi-source research reports with checked citations.",
    category: "research",
    iconName: "Telescope",
    version: "2.1.0",
    releasedAt: "2026-06-18T00:00:00.000Z",
    recommendedScope: "user",
    isOfficial: true,
    installStatus: { kind: "not-installed" },
  },
  {
    itemId: "demo-item-calendar",
    skillId: "calendar-keeper",
    publisherTier: "verified",
    publisherName: "Vynel Labs",
    publisherUrl: null,
    displayName: "Calendar Keeper",
    oneLineDescription: "Plans your week and protects focus time.",
    category: "calendar",
    iconName: "CalendarClock",
    version: "1.4.2",
    releasedAt: "2026-06-30T00:00:00.000Z",
    recommendedScope: "user",
    isOfficial: false,
    installStatus: {
      kind: "installed",
      scope: "user",
      installedSkillId: "demo-installed-calendar",
      versionInstalled: "1.4.2",
    },
  },
  {
    itemId: "demo-item-email",
    skillId: "email-drafter",
    publisherTier: "verified",
    publisherName: "Vynel Labs",
    publisherUrl: null,
    displayName: "Email Drafter",
    oneLineDescription:
      "Drafts replies in your tone, ready to approve and send.",
    category: "email",
    iconName: "MailPlus",
    version: "1.2.0",
    releasedAt: "2026-05-12T00:00:00.000Z",
    recommendedScope: "workspace",
    isOfficial: false,
    installStatus: {
      kind: "installed",
      scope: "workspace",
      installedSkillId: "demo-installed-email",
      versionInstalled: "1.1.0",
    },
  },
];
