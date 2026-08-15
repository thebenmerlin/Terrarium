// Camera — pixi-viewport, configured for a close, gamified, top-down view.
//
// Worth noting why this file is so short: drag-to-pan and zoom-toward-cursor
// are pixi-viewport defaults. The previous three.js renderer needed a large
// amount of hand-written code for exactly these two behaviours (OrbitControls
// has neither) and still didn't feel right. In 2D they're free.
//
// Wheel/drag split is deliberately NOT the pixi-viewport default (which
// zooms on every wheel event, trackpad or mouse). That reads as broken on a
// trackpad: a plain two-finger scroll — which should just pan, Google-Maps
// style — instead zooms the map. Fix is `wheel({ wheelZoom: false })` so the
// Wheel plugin stops treating scroll as zoom, which hands wheel events to
// Drag's own built-in wheel-pan support instead (drag() defaults to
// wheel: true — it was just never winning because Wheel claimed the event
// first). `trackpadPinch: true` keeps real pinch gestures zooming: browsers
// report trackpad pinch as a wheel event with ctrlKey set, which Drag's
// wheel-pan explicitly excludes, so pinch and two-finger-scroll cleanly
// split into zoom vs pan without touching Pinch (that plugin only ever sees
// genuine multi-touch, not trackpad gestures).
//
// `bounce()`, not `clamp()`, holds the camera to the world. `clamp()`
// enforces its bounds live, every frame, including mid-drag — and once the
// world is smaller than the screen (easy to reach: this world is only
// 960x704 units, and MIN_ZOOM alone gets most windows there), its two
// opposing edge constraints (left >= 0, right <= worldWidth) both fight the
// same drag at once and the camera can't move on ANY axis, in ANY
// direction — drag looked entirely dead at low zoom. `bounce()` only
// corrects position on release (spring back if you let go out of bounds),
// so dragging itself is always unobstructed, at any zoom.

import type { Application } from "pixi.js";
import { Viewport } from "pixi-viewport";

/** Starting zoom. Tiles are 16px, so 3x shows ~26x16 tiles on a 1280x800
 * canvas — close to the reference screenshots' framing, where individual
 * characters and house details are clearly legible. */
export const DEFAULT_ZOOM = 3;

const MIN_ZOOM = 1; // any further out and 16px tiles stop being readable
const MAX_ZOOM = 8;

export function createViewport(app: Application, worldWidth: number, worldHeight: number): Viewport {
  const viewport = new Viewport({
    screenWidth: app.screen.width,
    screenHeight: app.screen.height,
    worldWidth,
    worldHeight,
    // pixi-viewport 6.x needs the event system passed explicitly.
    events: app.renderer.events,
  });

  app.stage.addChild(viewport);

  viewport
    .drag({ pressDrag: true })
    .pinch({ axis: "all" })
    .wheel({ wheelZoom: true, percent: 0.1, trackpadPinch: true })
    .decelerate({ friction: 0.9 })
    .clampZoom({ minScale: MIN_ZOOM, maxScale: MAX_ZOOM })
    .bounce({ sides: "all", underflow: "center" });

  viewport.setZoom(DEFAULT_ZOOM, true);
  viewport.moveCenter(worldWidth / 2, worldHeight / 2);

  // Grab-to-pan cursor, Google-Maps style: an open hand at rest, a closed
  // fist while actually dragging.
  app.canvas.style.cursor = "grab";
  viewport.on("drag-start", () => {
    app.canvas.style.cursor = "grabbing";
  });
  viewport.on("drag-end", () => {
    app.canvas.style.cursor = "grab";
  });

  window.addEventListener("resize", () => {
    viewport.resize(app.screen.width, app.screen.height, worldWidth, worldHeight);
  });

  setupKeyboardNavigation(app, viewport);

  return viewport;
}

function setupKeyboardNavigation(app: Application, viewport: Viewport): void {
  const keysPressed = new Set<string>();

  const onKeyDown = (e: KeyboardEvent) => {
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      (document.activeElement as HTMLElement)?.isContentEditable
    ) {
      return;
    }
    keysPressed.add(e.key);
    keysPressed.add(e.code);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keysPressed.delete(e.key);
    keysPressed.delete(e.code);
  };

  const onBlur = () => {
    keysPressed.clear();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  app.ticker.add((ticker) => {
    if (keysPressed.size === 0) return;

    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    if (dt <= 0) return;

    let moveX = 0;
    let moveY = 0;
    let zoomChange = 0;

    const hasKey = (...keys: string[]) => keys.some((k) => keysPressed.has(k));

    // Directional navigation (^ v < >, Arrow keys, WASD)
    if (hasKey("ArrowUp", "w", "W", "KeyW", "^")) moveY -= 1;
    if (hasKey("ArrowDown", "s", "S", "KeyS", "v", "V")) moveY += 1;
    if (hasKey("ArrowLeft", "a", "A", "KeyA")) moveX -= 1;
    if (hasKey("ArrowRight", "d", "D", "KeyD")) moveX += 1;

    // Zoom / forward-backward navigation (< >, +, -, PageUp, PageDown)
    if (hasKey("+", "=", "Equal", "PageUp", "i", "I", "KeyI")) zoomChange += 1;
    if (hasKey("-", "_", "Minus", "PageDown", "o", "O", "KeyO")) zoomChange -= 1;

    // Direct support for < (KeyComma / Comma) and > (KeyPeriod / Period)
    if (hasKey("<", ",")) {
      if (hasKey("Shift") || hasKey("<")) {
        zoomChange -= 1; // Backward / zoom out
      } else {
        moveX -= 1; // Left
      }
    }
    if (hasKey(">", ".")) {
      if (hasKey("Shift") || hasKey(">")) {
        zoomChange += 1; // Forward / zoom in
      } else {
        moveX += 1; // Right
      }
    }

    // Apply smooth position movement
    if (moveX !== 0 || moveY !== 0) {
      const len = Math.hypot(moveX, moveY);
      const speed = 600 / viewport.scale.x; // pan speed in world units per second
      const dx = (moveX / len) * speed * dt;
      const dy = (moveY / len) * speed * dt;

      viewport.moveCenter(viewport.center.x + dx, viewport.center.y + dy);
    }

    // Apply smooth zoom change
    if (zoomChange !== 0) {
      const zoomFactor = 1 + zoomChange * 1.5 * dt;
      const currentScale = viewport.scale.x;
      const targetScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentScale * zoomFactor));
      viewport.setZoom(targetScale, true);
    }
  });
}

