// Whether Demo Mode is armed, as a CROSS-WINDOW fact. A wake can land in
// whichever window holds the daemon link — the app, or the display dock in its
// own webview — and each holds its own Pinia; localStorage is the one place
// both can read at the moment the wake arrives.
//
// The flag carries its arming TIME and expires on its own: an armed flag that
// survived film day would silently swallow every real "Hey Claude" wake after
// it. Six hours covers a shoot; day-after wakes behave normally again.

const DEMO_ARMED_STORAGE_KEY = "vynel.demo-mode-armed-at";
const DEMO_ARMED_TTL_MS = 6 * 60 * 60 * 1000;

export function readDemoArmedFlag(): boolean {
  const raw = localStorage.getItem(DEMO_ARMED_STORAGE_KEY);
  if (raw === null) return false;
  const armedAt = Number(raw);
  if (!Number.isFinite(armedAt) || Date.now() - armedAt > DEMO_ARMED_TTL_MS) {
    localStorage.removeItem(DEMO_ARMED_STORAGE_KEY);
    return false;
  }
  return true;
}

export function writeDemoArmedFlag(armed: boolean): void {
  if (armed) localStorage.setItem(DEMO_ARMED_STORAGE_KEY, String(Date.now()));
  else localStorage.removeItem(DEMO_ARMED_STORAGE_KEY);
}
