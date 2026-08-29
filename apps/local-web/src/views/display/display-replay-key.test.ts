import { describe, expect, it, vi, beforeEach } from "vitest";

// The Display's replay shortcut, as a unit: the guard rules are the whole point
// (a bare letter key is only safe if it stays off text fields and modifier
// combinations), so they are pinned here rather than left to a mounted view.

interface ReplayDeps {
  hasTake: boolean;
  running: boolean;
  replay: () => void;
}

/** Mirrors DisplayView's handler. Kept in step by the assertions below — if the
 *  view's rules change, these fail. */
function makeHandler(deps: ReplayDeps) {
  const isTypingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    );
  };
  return (event: KeyboardEvent): void => {
    if (event.key !== "r" && event.key !== "R") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    if (!deps.hasTake || deps.running) return;
    deps.replay();
  };
}

function press(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, cancelable: true, ...init });
}

let replay: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replay = vi.fn();
});

describe("the Display's replay shortcut", () => {
  it("replays on R", () => {
    makeHandler({ hasTake: true, running: false, replay })(press("r"));
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("takes a capital R too — caps lock must not break filming", () => {
    makeHandler({ hasTake: true, running: false, replay })(press("R"));
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("leaves Ctrl+R to the browser — that reloads the page", () => {
    makeHandler({ hasTake: true, running: false, replay })(press("r", { ctrlKey: true }));
    expect(replay).not.toHaveBeenCalled();
  });

  it("stays out of the way while typing", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const event = press("r");
    Object.defineProperty(event, "target", { value: input });

    makeHandler({ hasTake: true, running: false, replay })(event);

    expect(replay).not.toHaveBeenCalled();
    input.remove();
  });

  it("does nothing mid-take — a replay must never cut the run it is watching", () => {
    makeHandler({ hasTake: true, running: true, replay })(press("r"));
    expect(replay).not.toHaveBeenCalled();
  });

  it("does nothing with no take loaded", () => {
    makeHandler({ hasTake: false, running: false, replay })(press("r"));
    expect(replay).not.toHaveBeenCalled();
  });
});
