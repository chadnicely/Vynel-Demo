// Arc 1 diagnostic, step 2 — characterize the ask→land transform.
//
// The first probe showed drift on BOTH monitors with different x and y ratios,
// which rules out a single DPI scale factor. This samples a grid on the primary
// monitor, reads each landing back twice (to separate "settling" from a real
// transform), and fits land = scale*ask + offset per axis.
//
// SAFE: cursor only, restored at the end.
//
//   node scripts/src/desktop/probe-coordinate-fit.mjs

import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function findPnpmStore() {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = resolve(directory, 'node_modules/.pnpm')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) throw new Error('node_modules/.pnpm not found in any parent')
    directory = parent
  }
}

const store = findPnpmStore()
const entries = readdirSync(store)
const findEntry = (prefix) => {
  const match = entries.find((entry) => entry.startsWith(prefix))
  if (match === undefined) throw new Error(`${prefix}* not found in ${store}`)
  return match
}
const load = (storeDirectory, packageName) =>
  require(resolve(store, storeDirectory, 'node_modules', packageName))

const screenshots = load(findEntry('node-screenshots@'), 'node-screenshots')
const nut = load(findEntry('@nut-tree-fork+nut-js@'), '@nut-tree-fork/nut-js')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Least-squares fit of land = scale*ask + offset. */
function fit(samples) {
  const n = samples.length
  const sumAsk = samples.reduce((total, s) => total + s.ask, 0)
  const sumLand = samples.reduce((total, s) => total + s.land, 0)
  const sumAskLand = samples.reduce((total, s) => total + s.ask * s.land, 0)
  const sumAskSq = samples.reduce((total, s) => total + s.ask * s.ask, 0)
  const denominator = n * sumAskSq - sumAsk * sumAsk
  if (denominator === 0) return { scale: Number.NaN, offset: Number.NaN }
  const scale = (n * sumAskLand - sumAsk * sumLand) / denominator
  return { scale, offset: (sumLand - scale * sumAsk) / n }
}

async function main() {
  // Optional arg: a monitor id (from the first probe). Defaults to the primary.
  const wantedId = process.argv[2] === undefined ? null : Number(process.argv[2])
  const monitors = screenshots.Monitor.all()
  const target =
    wantedId === null
      ? monitors.find((monitor) => monitor.isPrimary())
      : monitors.find((monitor) => monitor.id() === wantedId)
  if (target === undefined) {
    throw new Error(`No monitor ${wantedId}. Available: ${monitors.map((m) => m.id()).join(', ')}`)
  }

  const origin = await nut.mouse.getPosition()
  console.log(`start (${origin.x}, ${origin.y}) — will restore\n`)
  console.log(
    `monitor ${target.id()}: origin ${target.x()},${target.y()}  ` +
      `${target.width()}x${target.height()}  scale ${target.scaleFactor()}\n`,
  )

  const fractions = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]
  const xSamples = []
  const ySamples = []

  console.log('  asked        settle(150ms)   again(+400ms)   drift')
  for (const fraction of fractions) {
    // Sample WITHIN the monitor's own rectangle, in its reported coordinates.
    const ask = {
      x: Math.round(target.x() + target.width() * fraction),
      y: Math.round(target.y() + target.height() * fraction),
    }
    await nut.mouse.setPosition(new nut.Point(ask.x, ask.y))
    await sleep(150)
    const first = await nut.mouse.getPosition()
    await sleep(400)
    const second = await nut.mouse.getPosition()

    xSamples.push({ ask: ask.x, land: second.x })
    ySamples.push({ ask: ask.y, land: second.y })

    const settled = first.x === second.x && first.y === second.y ? '' : '  (STILL MOVING)'
    console.log(
      `  (${String(ask.x).padStart(4)},${String(ask.y).padStart(4)})   ` +
        `(${String(first.x).padStart(4)},${String(first.y).padStart(4)})        ` +
        `(${String(second.x).padStart(4)},${String(second.y).padStart(4)})       ` +
        `(${second.x - ask.x}, ${second.y - ask.y})${settled}`,
    )
  }

  const xFit = fit(xSamples)
  const yFit = fit(ySamples)
  console.log('\n--- fit: land = scale * ask + offset ---')
  console.log(`  x: scale ${xFit.scale.toFixed(5)}  offset ${xFit.offset.toFixed(2)}`)
  console.log(`  y: scale ${yFit.scale.toFixed(5)}  offset ${yFit.offset.toFixed(2)}`)

  const near = (value, target) => Math.abs(value - target) < 0.01
  console.log('\n--- reading ---')
  if (near(xFit.scale, 1) && near(yFit.scale, 1)) {
    if (Math.abs(xFit.offset) < 2 && Math.abs(yFit.offset) < 2) {
      console.log('  IDENTITY — the spaces agree; earlier drift was a settling artifact.')
    } else {
      console.log('  PURE OFFSET — a constant translation, not a scale. Suspect a virtual-desktop')
      console.log('  origin difference rather than DPI.')
    }
  } else {
    console.log(`  SCALED — x by ${(1 / xFit.scale).toFixed(4)}, y by ${(1 / yFit.scale).toFixed(4)}`)
    console.log('  Compare against the monitor scale factor and the physical/logical ratio.')
  }

  await nut.mouse.setPosition(new nut.Point(origin.x, origin.y))
  console.log(`\nrestored to (${origin.x}, ${origin.y})`)
}

main().catch((error) => {
  console.error('probe failed:', error?.message ?? error)
  process.exitCode = 1
})
