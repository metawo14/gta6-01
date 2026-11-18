// Keyboard and mouse input.
// Two sources of truth: the real device and an `override` object that the headless tools and
// the screenshot staging write into. Held keys live in sets, just-pressed keys live in a set
// that the game clears at the end of every frame.

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.heldKeys = new Set();
    this.pressedKeys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.mousePressed = false;
    this.pointerLocked = false;
    this.dragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.override = {
      keys: new Set(),
      pressed: new Set(),
      mouse: { dx: 0, dy: 0 },
      fire: false,
      firePressed: false,
    };
    this.gestureHandlers = [];
    this._bind();
  }

  onFirstGesture(fn) {
    this.gestureHandlers.push(fn);
  }

  _gesture() {
    const list = this.gestureHandlers;
    this.gestureHandlers = [];
    for (const fn of list) {
      try { fn(); } catch { /* a sound that cannot start must not stop the game */ }
    }
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      this._gesture();
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      if (!this.heldKeys.has(e.code)) this.pressedKeys.add(e.code);
      this.heldKeys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.heldKeys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.heldKeys.clear();
      this.mouseDown = false;
    });

    const canvas = this.canvas;
    canvas.addEventListener('mousedown', (e) => {
      this._gesture();
      if (e.button === 0) {
        this.mouseDown = true;
        this.mousePressed = true;
      }
      this.dragging = true;
      this.lastPointer.x = e.clientX;
      this.lastPointer.y = e.clientY;
      if (canvas.requestPointerLock) {
        try { canvas.requestPointerLock(); } catch { /* pointer lock can be refused */ }
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      } else if (this.dragging) {
        this.mouseDX += e.clientX - this.lastPointer.x;
        this.mouseDY += e.clientY - this.lastPointer.y;
        this.lastPointer.x = e.clientX;
        this.lastPointer.y = e.clientY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _active(code) {
    return this.heldKeys.has(code) || this.override.keys.has(code);
  }

  _pressedNow(code) {
    return this.pressedKeys.has(code) || this.override.pressed.has(code);
  }

  held(code) { return this._active(code); }

  pressed(code) {
    if (this._pressedNow(code)) return true;
    return false;
  }

  anyPressed(codes) {
    return codes.some((c) => this._pressedNow(c));
  }

  axis() {
    let x = 0;
    let z = 0;
    if (this._active('KeyW') || this._active('ArrowUp')) z -= 1;
    if (this._active('KeyS') || this._active('ArrowDown')) z += 1;
    if (this._active('KeyA') || this._active('ArrowLeft')) x -= 1;
    if (this._active('KeyD') || this._active('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  moveKeyDown() {
    for (const k of MOVE_KEYS) if (this._active(k)) return true;
    return false;
  }

  consumeMouse() {
    const dx = this.mouseDX + this.override.mouse.dx;
    const dy = this.mouseDY + this.override.mouse.dy;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.override.mouse.dx = 0;
    this.override.mouse.dy = 0;
    return { dx, dy };
  }

  fireHeld() {
    return this.mouseDown || this.override.fire;
  }

  firePressed() {
    return this.mousePressed || this.override.firePressed;
  }

  endFrame() {
    this.pressedKeys.clear();
    this.mousePressed = false;
    this.override.pressed.clear();
    this.override.firePressed = false;
  }

  // --- headless driving -------------------------------------------------
  // The tools set keys and fire a click through this, so the game runs exactly as a player
  // would drive it without a keyboard attached.

  overridePress(code) {
    this.override.keys.add(code);
    this.override.pressed.add(code);
  }

  overrideRelease(code) {
    this.override.keys.delete(code);
  }

  overrideClick() {
    this.override.firePressed = true;
  }

  overrideAim(dx, dy) {
    this.override.mouse.dx += dx;
    this.override.mouse.dy += dy;
  }

  releaseAll() {
    this.override.keys.clear();
    this.override.pressed.clear();
    this.override.fire = false;
    this.override.firePressed = false;
  }
}
