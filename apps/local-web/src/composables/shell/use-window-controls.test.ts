import { describe, expect, it } from "vitest";
import { useWindowControls } from "./use-window-controls.js";

// happy-dom has no `window.__TAURI__`, so these exercise the browser fallback:
// the chrome is simulated and the OS controls don't exist to drive.
describe("useWindowControls (browser)", () => {
  it("reports non-Tauri and no-ops minimize/close without throwing", () => {
    const controls = useWindowControls();
    expect(controls.isTauri).toBe(false);
    expect(() => {
      controls.minimize();
      controls.close();
    }).not.toThrow();
  });

  it("toggles the maximized flag locally", () => {
    const controls = useWindowControls();
    expect(controls.isMaximized.value).toBe(false);
    controls.toggleMaximize();
    expect(controls.isMaximized.value).toBe(true);
    controls.toggleMaximize();
    expect(controls.isMaximized.value).toBe(false);
  });
});
