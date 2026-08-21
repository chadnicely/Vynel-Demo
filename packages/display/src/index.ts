// Public surface of `@vynel/display` — the Display leaf: the glanceable board
// beside the conversation, and the widgets Claude puts on it while it talks.
// Consumers reach the package only through this barrel; schema and
// repositories are internal.
//
// Every mutation takes an optional `DisplayLiveSink`. The op writes its row +
// outbox event in one transaction and publishes the frame only AFTER that
// commits — the outbox row is the durable record, the frame is the fast path.

export type { DisplayLiveSink, DisplayOpDeps } from './display-live-sink.js'

export {
  DISPLAY_CLEARED,
  DISPLAY_WIDGET_REMOVED,
  DISPLAY_WIDGET_UPSERTED,
  type DisplayClearedPayload,
  type DisplayWidgetRemovalReason,
  type DisplayWidgetRemovedPayload,
  type DisplayWidgetUpsertedPayload,
} from './display-events.js'

export { addDisplayWidget, type AddDisplayWidgetInput } from './lifecycle/add-display-widget.js'
export {
  updateDisplayWidget,
  type UpdateDisplayWidgetInput,
} from './lifecycle/update-display-widget.js'
export {
  removeDisplayWidget,
  type RemoveDisplayWidgetInput,
} from './lifecycle/remove-display-widget.js'
export {
  clearDisplayWidgets,
  type ClearDisplayWidgetsInput,
} from './lifecycle/clear-display-widget.js'
export {
  sweepExpiredDisplayWidgets,
  type SweepExpiredDisplayWidgetsInput,
} from './lifecycle/sweep-expired-display-widgets.js'
export {
  listDisplayWidgets,
  type ListDisplayWidgetsInput,
} from './queries/list-display-widgets.js'
