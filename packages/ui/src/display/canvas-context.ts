/**
 * Both the orb's frame loop and its mote sprites need a 2D context, and
 * neither can do anything useful without one. Failing here — with one message,
 * once — keeps `| null` out of every draw call downstream.
 */
export function require2dContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(
      "canvas 2D context unavailable — the Display orb needs canvas 2D support",
    );
  }
  return context;
}
