// Arc 1 diagnostic — does nut.js agree with node-screenshots about where a pixel is?
//
// Reads the monitor topology from node-screenshots (physical pixels, per-monitor
// scale), then asks nut.js to place the cursor at a known point on EACH monitor
// and reads the position back. A mismatch is the DPI/coordinate-space divergence
// documented in `input/input-authorization.ts:32-37`.
//
// SAFE: moves only the cursor (no clicks, no keys), and restores the original
// position at the end — including on failure. Run it, read the verdict, done.
//
//   node scripts/src/desktop/probe-coordinate-space.mjs

import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// A git worktree has no `node_modules` of its own, so walk up from this file
// until we find the store — that lands on the main checkout when run from a
// worktree, and on the repo root otherwise.
function findPnpmStore() {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = resolve(directory, 'node_modules/.pnpm')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) {
      throw new Error(
        'Could not find node_modules/.pnpm in any parent directory. Run `pnpm install` first, ' +
          'or run this script from the main checkout.',
      )
    }
    directory = parent
  }
}

const store = findPnpmStore()
const packageIn = (storeDirectory, packageName) =>
  resolve(store, storeDirectory, 'node_modules', packageName)

const entries = readdirSync(store)
const findEntry = (prefix) => {
  const match = entries.find((entry) => entry.startsWith(prefix))
  if (match === undefined) throw new Error(`${prefix}* not found in the pnpm store at ${store}`)
  return match
}

const screenshots = require(packageIn(findEntry('node-screenshots@'), 'node-screenshots'))
const nut = require(
  packageIn(findEntry('@nut-tree-fork+nut-js@'), '@nut-tree-fork/nut-js'),
)

// A point comfortably inside a monitor, away from edges and the taskbar.
function probePointFor(monitor) {
  return {
    x: Math.round(monitor.x() + monitor.width() / 2),
    y: Math.round(monitor.y() + monitor.height() / 2),
  }
}

async function main() {
  const monitors = screenshots.Monitor.all()
  const origin = await nut.mouse.getPosition()
  console.log(`Cursor starts at (${origin.x}, ${origin.y}) — will be restored.\n`)

  console.log('Monitors reported by node-screenshots:')
  for (const monitor of monitors) {
    console.log(
      `  id ${monitor.id()}  origin ${monitor.x()},${monitor.y()}  ` +
        `size ${monitor.width()}x${monitor.height()}  scale ${monitor.scaleFactor()}` +
        `${monitor.isPrimary() ? '  (primary)' : ''}`,
    )
  }
  console.log(`\nnut.js screen: ${await nut.screen.width()}x${await nut.screen.height()}\n`)

  const results = []
  for (const monitor of monitors) {
    const target = probePointFor(monitor)
    await nut.mouse.setPosition(new nut.Point(target.x, target.y))
    // Let the OS settle the cursor before reading it back.
    await new Promise((done) => setTimeout(done, 120))
    const landed = await nut.mouse.getPosition()
    const driftX = landed.x - target.x
    const driftY = landed.y - target.y
    results.push({ monitor, target, landed, driftX, driftY })
    console.log(
      `monitor ${monitor.id()} (scale ${monitor.scaleFactor()}):\n` +
        `   asked  (${target.x}, ${target.y})\n` +
        `   landed (${landed.x}, ${landed.y})\n` +
        `   drift  (${driftX}, ${driftY})${driftX === 0 && driftY === 0 ? '  OK' : '  <-- MISMATCH'}`,
    )
  }

  console.log('\n--- verdict ---')
  const bad = results.filter((entry) => entry.driftX !== 0 || entry.driftY !== 0)
  if (bad.length === 0) {
    console.log('Coordinate spaces AGREE on every monitor.')
    console.log('=> nut.js and node-screenshots share one space; no DPI translation needed.')
  } else {
    for (const entry of bad) {
      const ratioX = entry.landed.x !== 0 ? (entry.target.x / entry.landed.x).toFixed(4) : 'n/a'
      const ratioY = entry.landed.y !== 0 ? (entry.target.y / entry.landed.y).toFixed(4) : 'n/a'
      console.log(
        `monitor ${entry.monitor.id()} DIVERGES. scale=${entry.monitor.scaleFactor()}  ` +
          `asked/landed ratio x=${ratioX} y=${ratioY}`,
      )
      console.log(
        '   If the ratio matches the scale factor, the fix is DPI awareness / per-monitor scaling.',
      )
    }
  }

  await nut.mouse.setPosition(new nut.Point(origin.x, origin.y))
  console.log(`\nCursor restored to (${origin.x}, ${origin.y}).`)
}

main().catch(async (error) => {
  console.error('probe failed:', error?.message ?? error)
  try {
    // Best effort: never leave the cursor parked somewhere unexpected.
    const home = await nut.mouse.getPosition()
    console.error(`cursor left at (${home.x}, ${home.y})`)
  } catch {
    // Reading the position failed too — nothing safe left to do.
  }
  process.exitCode = 1
})
