// The monitors tick — the session tier's composition of the `@vynel/monitors`
// leaf (does this watch fire?) with the orchestration queues (how the owner is
// woken). Exposed as its own subpath so the api's service loop imports the tick
// without pulling the whole session barrel.

export {
  runMonitorTick,
  type RunMonitorTickDeps,
  type MonitorTickResult,
} from './run-monitor-tick.js'
