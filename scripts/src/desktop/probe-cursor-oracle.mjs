// Arc 1, ground truth — nut.js's getPosition is NOT a trustworthy oracle for
// where the cursor actually is.
//
// Earlier probes fitted `landed = f(asked)` using nut.js for BOTH halves, which
// cannot distinguish "setPosition transformed my input" from "getPosition
// reports in a different space". This asks Win32 `GetCursorPos` from a separate
// process instead — an independent witness — after each nut.js placement.
//
// SAFE: cursor only, restored at the end.
//
//   node scripts/src/desktop/probe-cursor-oracle.mjs

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
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
const load = (prefix, packageName) => {
  const match = entries.find((entry) => entry.startsWith(prefix))
  if (match === undefined) throw new Error(`${prefix}* not found`)
  return require(resolve(store, match, 'node_modules', packageName))
}
const screenshots = load('node-screenshots@', 'node-screenshots')
const nut = load('@nut-tree-fork+nut-js@', '@nut-tree-fork/nut-js')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// Win32 GetCursorPos, per-monitor DPI aware so it reports PHYSICAL pixels —
// the same space node-screenshots geometry lives in.
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
  const line = out.trim().split(/\r?\n/).pop()
  const [x, y] = line.split(',').map(Number)
  return { x, y }
}

async function main() {
  const monitors = screenshots.Monitor.all()
  console.log('monitors (node-screenshots):')
  for (const m of monitors) {
    console.log(
      `   id ${m.id()} origin ${m.x()},${m.y()} size ${m.width()}x${m.height()} scale ${m.scaleFactor()}`,
    )
  }

  const origin = await nut.mouse.getPosition()
  const scaled = monitors.find((m) => m.scaleFactor() !== 1)
  const primary = monitors.find((m) => m.isPrimary())

  const targets = [
    { label: 'primary centre    ', x: Math.round(primary.x() + primary.width() / 2), y: Math.round(primary.y() + primary.height() / 2) },
  ]
  if (scaled !== undefined) {
    targets.push(
      { label: 'scaled mon centre ', x: Math.round(scaled.x() + scaled.width() / 2), y: Math.round(scaled.y() + scaled.height() / 2) },
      { label: 'scaled mon quarter', x: Math.round(scaled.x() + scaled.width() / 4), y: Math.round(scaled.y() + scaled.height() / 4) },
    )
  }

  console.log('\nasked nut.js for ->  nut.getPosition says  |  Win32 GetCursorPos says (truth)')
  for (const target of targets) {
    await nut.mouse.setPosition(new nut.Point(target.x, target.y))
    await sleep(200)
    const nutSays = await nut.mouse.getPosition()
    const truth = win32CursorPos()
    const nutAgrees = nutSays.x === truth.x && nutSays.y === truth.y
    const askHonoured = truth.x === target.x && truth.y === target.y
    console.log(
      `${target.label} (${target.x},${target.y}) -> (${nutSays.x},${nutSays.y})  |  (${truth.x},${truth.y})  ` +
        `${nutAgrees ? 'get==truth' : 'GET-DISAGREES'}  ${askHonoured ? 'SET-HONOURED' : 'set-transformed'}`,
    )
  }

  await nut.mouse.setPosition(new nut.Point(origin.x, origin.y))
  console.log(`\ncursor restored to (${origin.x}, ${origin.y})`)
}

main().catch((error) => {
  console.error('probe failed:', error?.message ?? error)
  process.exitCode = 1
})
