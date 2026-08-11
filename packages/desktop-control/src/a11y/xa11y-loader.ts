// The SINGLE point that loads xa11y — the native accessibility engine behind
// desktop control. The `a11y/` folder is the xa11y boundary; every other file
// in it works through the types + helpers here, so any quirk of the binding
// (CJS interop, missing .d.ts members, error taxonomy) stays contained.
//
// xa11y is a native CJS module. It is loaded LAZILY via `createRequire` on the
// first desktop op — so merely importing this module (in tests, or on a
// platform without the prebuilt binary) never pulls the native binary. The
// module SHAPE comes from an `import type` namespace, which is erased at
// compile time — a value import here would defeat the whole lazy load.

import { createRequire } from 'node:module'
import type * as Xa11y from '@crowecawcaw/xa11y'

export type Xa11yModule = typeof Xa11y

// The native xa11y App instance (what App.find / App.byPid resolve to). Its
// shipped .d.ts omits `dump`/`tree` (present at runtime); cast where used.
export type Xa11yAppInstance = Awaited<ReturnType<Xa11yModule['App']['byPid']>>
export type Xa11ySubscription = Awaited<ReturnType<Xa11yAppInstance['subscribe']>>

let cachedXa11y: Xa11yModule | undefined

export function loadXa11y(): Xa11yModule {
  if (cachedXa11y !== undefined) {
    return cachedXa11y
  }
  try {
    const requireFromHere = createRequire(import.meta.url)
    cachedXa11y = requireFromHere('@crowecawcaw/xa11y') as Xa11yModule
    return cachedXa11y
  } catch (cause) {
    throw new Error(
      'Desktop control is unavailable: the xa11y accessibility engine failed to load (it needs the ' +
        'prebuilt native binary for this OS/arch). ' +
        (cause instanceof Error ? cause.message : String(cause)),
    )
  }
}

// Read an app's tree — xa11y's `dump` isn't in the shipped .d.ts, so cast here.
export function dumpApp(app: Xa11yAppInstance, maxDepth: number): Promise<string> {
  return (app as unknown as { dump(maxDepth?: number): Promise<string> }).dump(maxDepth)
}

// Hard backstop so a desktop op can NEVER hang the brain. A custom-drawn control
// (Telegram/Qt, some Electron) can make xa11y's press/dump block indefinitely
// (the UIA Invoke never completes); this bounds the wait and surfaces an
// actionable error. The underlying native call may keep running in the
// background, but the caller returns instead of leaving the turn pending
// forever. Lives here (the a11y boundary) so every xa11y-touching file — the
// adapter's ops AND the wake loop's probes — bounds through the same guard.
export function withTimeout<T>(
  operation: Promise<T>,
  ms: number,
  label: string,
  options: { retryUpToMs?: number } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Two very different causes wear the same symptom: an app that is merely
      // SLOW (a huge window, a heavy Electron page, a cold start) and a control
      // that will NEVER answer (custom-drawn Qt, some Electron widgets). The old
      // message asserted the second and sent the model hunting for another
      // element — so a slow-but-fine app looked broken. When a longer attempt is
      // available, offer that FIRST and keep the dead-end as the fallback.
      const retryFirst =
        options.retryUpToMs !== undefined && options.retryUpToMs > ms
          ? `If the app is just slow (a big window, a heavy page, a cold start), retry the SAME ` +
            `call with timeoutMs up to ${options.retryUpToMs}. If it times out again at that limit, ` +
            'the target is likely a control that never responds: '
          : 'The target may be a custom-drawn control (e.g. Telegram/Qt) that does not respond to ' +
            'accessibility actions: '
      reject(
        new Error(
          `Desktop ${label} did not complete within ${ms / 1000}s. ${retryFirst}` +
            'try a different element, or fall back to screenshot_app — some apps can only be read ' +
            'as pixels, not acted on this way.',
        ),
      )
    }, ms)
    operation.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

// Release a held UIA subscription (xa11y's `Subscription.close()`). Best-effort.
export function closeSubscription(subscription: Xa11ySubscription): void {
  try {
    if (!subscription.closed) {
      subscription.close()
    }
  } catch {
    // Releasing the listener must never throw to the caller.
  }
}
