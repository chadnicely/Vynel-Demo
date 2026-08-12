// Live probe for whole-monitor capture — verifies node-screenshots' Monitor
// captureImageSync on the real desktop (the method screenshot_desktop rides).
// Run: node scripts/src/desktop/probe-screenshot-desktop.mjs
import { createRequire } from 'node:module'

// Resolve from @vynel/desktop-control's own tree — the binding is that
// package's dependency, exactly as its adapter loads it.
const require = createRequire(
  new URL('../../../packages/desktop-control/package.json', import.meta.url),
)
const { Monitor } = require('node-screenshots')

for (const monitor of Monitor.all()) {
  const image = monitor.captureImageSync()
  const png = await image.toPng()
  console.log(
    JSON.stringify({
      id: monitor.id(),
      name: monitor.name(),
      isPrimary: monitor.isPrimary(),
      reported: { x: monitor.x(), y: monitor.y(), width: monitor.width(), height: monitor.height() },
      captured: { width: image.width, height: image.height },
      pngBytes: png.length,
    }),
  )
}
