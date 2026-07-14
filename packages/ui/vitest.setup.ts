import { vi } from "vitest";

// happy-dom lacks a few browser APIs that Reka UI's overlays (floating-ui +
// focus/pointer utilities) touch on mount. Stub them so component tests can
// open menus/dialogs without throwing.
if (!("ResizeObserver" in globalThis)) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

if (!("matchMedia" in globalThis)) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

const elementProto = Element.prototype as unknown as Record<string, unknown>;
elementProto.scrollIntoView ??= () => {};
elementProto.hasPointerCapture ??= () => false;
elementProto.setPointerCapture ??= () => {};
elementProto.releasePointerCapture ??= () => {};
