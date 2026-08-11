// Arc 1, decisive test — exercise the coordinate path production actually uses.
//
// `resolveFrame` (input/input-authorization.ts) builds its frame from
// findAppWindowBounds -> node-screenshots **Window** bounds, NOT the Monitor
// API. So this asks: given a window on a scaled monitor, does
// windowOrigin + imageOffset land where nut.js puts the cursor?
//
// Mirrors translatePoint exactly: point = imageCoord / captureScale + origin.
//
// SAFE: cursor only, restored at the end. Needs a window titled VYNEL_DPI_PROBE
// (scratchpad/probe-window.ps1) or falls back to any window on a scaled monitor.
//
//   node scripts/src/desktop/probe-window-click-path.mjs

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Win32 GetCursorPos from a per-monitor-DPI-aware process — the independent
// witness. nut.js's getPosition cannot be used to judge nut.js's setPosition.
const ORACLE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Oracle {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
try { [void][Oracle]::SetProcessDpiAwareness(2) } catch {}
$p = New-Object Oracle+POINT
[void][Oracle]::GetCursorPos([ref]$p)
Write-Output "$($p.X),$($p.Y)"
`
function win32CursorPos() {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ORACLE],
    { encoding: 'utf8' },
  )
  const [x, y] = out.trim().split(/\r?\n/).pop().split(',').map(Number)
  return { x, y }
}

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
const load = (prefix, packageName) => {
  const match = entries.find((entry) => entry.startsWith(prefix))
  if (match === undefined) throw new Error(`${prefix}* not found in ${store}`)
  return require(resolve(store, match, 'node_modules', packageName))
}
const screenshots = load('node-screenshots@', 'node-screenshots')
const nut = load('@nut-tree-fork+nut-js@', '@nut-tree-fork/nut-js')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// The production downscale (a11y/screenshot-scale.ts) — kept in sync by hand.
const MAX_W = 1280
const MAX_H = 800
const computeCaptureScale = (w, h) => (w <= 0 || h <= 0 ? 1 : Math.min(1, MAX_W / w, MAX_H / h))

async function main() {
  const windows = screenshots.Window.all().filter((w) => {
    try {
      return !w.isMinimized() && w.width() > 120 && w.height() > 120
    } catch {
      return false
    }
  })
  const probe =
    windows.find((w) => {
      try {
        return (w.title() ?? '').includes('VYNEL_DPI_PROBE')
      } catch {
        return false
      }
    }) ?? windows.find((w) => w.currentMonitor().scaleFactor() !== 1)

  if (probe === undefined) {
    console.log('No window found on a scaled monitor. Start scratchpad/probe-window.ps1 first.')
    return
  }

  const monitor = probe.currentMonitor()
  const bounds = { x: probe.x(), y: probe.y(), width: probe.width(), height: probe.height() }
  const image = probe.captureImageSync()
  const scale = computeCaptureScale(bounds.width, bounds.height)

  console.log(`window "${probe.title()}" on monitor ${monitor.id()} (scale ${monitor.scaleFactor()})`)
  console.log(`   bounds ${bounds.width}x${bounds.height} at (${bounds.x}, ${bounds.y})`)
  console.log(`   capture ${image.width}x${image.height}   computeCaptureScale=${scale}\n`)

  const origin = await nut.mouse.getPosition()

  // Three points expressed the way the MODEL would: coordinates inside the
  // image it was shown, window-relative.
  const imagePoints = [
    { label: 'image centre    ', ix: Math.round(image.width / 2), iy: Math.round(image.height / 2) },
    { label: 'image near-TL   ', ix: Math.round(image.width * 0.2), iy: Math.round(image.height * 0.2) },
    { label: 'image near-BR   ', ix: Math.round(image.width * 0.8), iy: Math.round(image.height * 0.8) },
  ]

  let allInside = true
  for (const point of imagePoints) {
    // translatePoint, verbatim — no scaling bridge. The Win32 oracle below
    // proves this is already the space setPosition wants.
    const target = {
      x: Math.round(point.ix / scale + bounds.x),
      y: Math.round(point.iy / scale + bounds.y),
    }

    await nut.mouse.setPosition(new nut.Point(target.x, target.y))
    await sleep(160)
    // GROUND TRUTH: nut.js's own getPosition mis-reports on a scaled monitor
    // (measured — see probe-cursor-oracle.mjs), so it must NOT be the judge here.
    const landed = win32CursorPos()

    const inside =
      landed.x >= bounds.x &&
      landed.x < bounds.x + bounds.width &&
      landed.y >= bounds.y &&
      landed.y < bounds.y + bounds.height
    if (!inside) allInside = false
    const exact = Math.abs(landed.x - target.x) <= 1 && Math.abs(landed.y - target.y) <= 1

    console.log(
      `${point.label} image(${point.ix},${point.iy}) -> translate(${target.x},${target.y}) -> ` +
        `Win32 says(${landed.x},${landed.y}) ${exact ? 'ON-TARGET' : 'DRIFT'} ` +
        `${inside ? 'inside-window' : 'OUTSIDE-WINDOW'}`,
    )
  }

  await nut.mouse.setPosition(new nut.Point(origin.x, origin.y))
  console.log(`\ncursor restored to (${origin.x}, ${origin.y})`)
  console.log(
    `\nVERDICT: the window-relative click path is ${allInside ? 'COHERENT' : 'BROKEN'} on a ${monitor.scaleFactor()}x monitor.`,
  )
}

main().catch((error) => {
  console.error('probe failed:', error?.message ?? error)
  process.exitCode = 1
})
