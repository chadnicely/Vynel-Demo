// @vynel/ui — shared Vynel components + design tokens (public API re-exports only).
// Consumed by apps/local-web today and the cloud web view later.
export { default as ApprovalCard } from "./components/ApprovalCard.vue";
export { default as AttachmentChips } from "./components/AttachmentChips.vue";
export { default as ChatComposer } from "./components/ChatComposer.vue";
export { default as ClaudeMark } from "./components/ClaudeMark.vue";
export { default as CodeBlock } from "./components/CodeBlock.vue";
export { default as CommandPalette } from "./components/CommandPalette.vue";
export { default as ConfirmButton } from "./components/ConfirmButton.vue";
export { default as ContextMenu } from "./components/ContextMenu.vue";
export { default as InlineSuggestMenu } from "./components/InlineSuggestMenu.vue";
export { default as ContextRing } from "./components/ContextRing.vue";
export { default as DropdownMenu } from "./components/DropdownMenu.vue";
export { default as EmptyState } from "./components/EmptyState.vue";
export { default as IconButton } from "./components/IconButton.vue";
export { default as MarkdownText } from "./components/MarkdownText.vue";
export { default as MessageRow } from "./components/MessageRow.vue";
export { default as Modal } from "./components/Modal.vue";
export { default as PresenceDot } from "./components/PresenceDot.vue";
export { default as ResizablePanel } from "./components/ResizablePanel.vue";
export { default as SegmentedTabs } from "./components/SegmentedTabs.vue";
export { default as SelectChip } from "./components/SelectChip.vue";
export { default as ThinkingBlock } from "./components/ThinkingBlock.vue";
export { default as ThreadSkeleton } from "./components/ThreadSkeleton.vue";
export { default as ToolCallCard } from "./components/ToolCallCard.vue";
export { default as ToolCallList } from "./components/ToolCallList.vue";
export { default as AgentActivityPane } from "./components/AgentActivityPane.vue";
export type {
  AgentActivityLike,
  AgentActivityToolCallLike,
} from "./components/AgentActivityPane.vue";
export { deriveSettledAgentActivity } from "./tool-cards/subagent-activity.js";
export { displayToolName } from "./tool-cards/tool-presenters.js";
export { describeDesktopStep } from "./tool-cards/desktop-step-presenter.js";
export { useOpenModalCount } from "./components/modal-registry.js";
export { default as Tooltip } from "./components/Tooltip.vue";
export { default as VoiceOrb } from "./components/VoiceOrb.vue";
export { default as WorkspaceColorPicker } from "./components/WorkspaceColorPicker.vue";
export { default as WorkspaceColorSwatches } from "./components/WorkspaceColorSwatches.vue";
export {
  WORKSPACE_ACCENT_SLOTS,
  workspaceAccentVar,
  workspaceNameFromLabel,
} from "./lib/workspace-color.js";
export {
  formatMessageTimestamp,
  formatElapsed,
} from "./lib/format-timestamp.js";
export { workspaceMonogram } from "./lib/workspace-monogram.js";
export type { CommandItem } from "./components/CommandPalette.vue";
export type { ComposerOption } from "./components/ChatComposer.vue";
export type {
  ComposerSuggestItem,
  ComposerSuggestSources,
} from "./lib/use-composer-suggest.js";
export type { MenuItemModel } from "./components/menu-shared.js";
export type { SegmentedTab } from "./components/SegmentedTabs.vue";
export type { SelectChipOption } from "./components/SelectChip.vue";
export type { VoiceOrbState } from "./components/VoiceOrb.vue";
