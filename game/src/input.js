// Keyboard and mouse. Every key is tracked as held / just-pressed, and a scripted
// override lets the playtest and the screenshot staging drive the game with no keyboard.

const MOVE_KEYS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

const ACTION_KEYS = {
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
  KeyE: 'enter',
  KeyF: 'punch',
  KeyR: 'reload',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
  KeyH: 'horn',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.held = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, down: false, clicked: false };
    this.override = {
      active: false,
      held: new Set(),
      pressed: new Set(),
      mouse: { dx: 0, dy: 0, clicked: false },
    };
    this.pointerLocked = false;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.enabled = true;
    this.onFirstGesture = null;
    this._gestured = false;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab') return;
      const known = MOVE_KEYS[e.code] || ACTION_KEYS[e.code] || e.code === 'KeyS';
      if (known) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
      this._gesture();
    };
    this._onKeyUp = (e) => {
      this.held.delete(e.code);
    };
    this._onBlur = () => {
      this.held.clear();
      this.dragging = false;
      this.mouse.down = false;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);

    if (this.canvas) {
      this.canvas.addEventListener('mousedown', (e) => {
        this.mouse.down = true;
        this.mouse.clicked = true;
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this._gesture();
        if (this.canvas.requestPointerLock && !this.pointerLocked) {
          try {
            const p = this.canvas.requestPointerLock();
            if (p && p.catch) p.catch(() => {});
          } catch {
            /* drag-to-look fallback covers this */
          }
        }
      });
      window.addEventListener('mouseup', () => {
        this.mouse.down = false;
        this.dragging = false;
      });
      window.addEventListener('mousemove', (e) => {
        if (this.pointerLocked) {
          this.mouse.dx += e.movementX || 0;
          this.mouse.dy += e.movementY || 0;
        } else if (this.dragging) {
          this.mouse.dx += e.clientX - this.lastX;
          this.mouse.dy += e.clientY - this.lastY;
          this.lastX = e.clientX;
          this.lastY = e.clientY;
        }
      });
      document.addEventListener('pointerlockchange', () => {
        this.pointerLocked = document.pointerLockElement === this.canvas;
      });
    }
  }

  _gesture() {
    if (this._gestured) return;
    this._gestured = true;
    if (this.onFirstGesture) {
      try {
        this.onFirstGesture();
      } catch {
        /* audio may fail on odd browsers; never break input */
      }
    }
  }

  setOverride(active) {
    this.override.active = !!active;
    this.override.held.clear();
    this.override.pressed.clear();
    this.override.mouse.dx = 0;
    this.override.mouse.dy = 0;
    this.override.mouse.clicked = false;
  }

  holdAction(name, on = true) {
    const key = name.startsWith('Key') || name.startsWith('Digit') ? name : this._actionToKey(name);
    if (!key) return;
    if (on) this.override.held.add(key);
    else this.override.held.delete(key);
  }

  tapAction(name) {
    const key = name.startsWith('Key') || name.startsWith('Digit') ? name : this._actionToKey(name);
    if (!key) return;
    this.override.held.add(key);
    this.override.pressed.add(key);
  }

  _actionToKey(name) {
    for (const [k, v] of Object.entries(MOVE_KEYS)) if (v === name) return k;
    for (const [k, v] of Object.entries(ACTION_KEYS)) if (v === name) return k;
    if (name === 'fire') return '__fire';
    return null;
  }

  isHeld(name) {
    const key = this._actionToKey(name);
    if (this.override.active) {
      if (key === '__fire') return false;
      return key ? this.override.held.has(key) : false;
    }
    return key ? this.held.has(key) : false;
  }

  justPressed(name) {
    const key = this._actionToKey(name);
    if (this.override.active) {
      if (key === '__fire') return this.override.mouse.clicked;
      return key ? this.override.pressed.has(key) : false;
    }
    return key ? this.pressed.has(key) : false;
  }

  get fireClicked() {
    return this.override.active ? this.override.mouse.clicked : this.mouse.clicked;
  }

  get fireHeld() {
    if (this.override.active) return false;
    return this.mouse.down;
  }

  // Movement axis, camera-relative on foot and car-relative while driving.
  axis() {
    let x = 0;
    let y = 0;
    if (this.isHeld('forward')) y += 1;
    if (this.isHeld('back')) y -= 1;
    if (this.isHeld('left')) x -= 1;
    if (this.isHeld('right')) x += 1;
    return { x, y };
  }

  takeMouse() {
    const src = this.override.active ? this.override.mouse : this.mouse;
    const out = { dx: src.dx, dy: src.dy };
    src.dx = 0;
    src.dy = 0;
    return out;
  }

  mouseDeltaX() {
    return this.takeMouse().dx;
  }

  anyKeyJustPressed() {
    if (this.override.active) return this.override.pressed.size > 0;
    return this.pressed.size > 0;
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
    this.override.pressed.clear();
    this.override.mouse.clicked = false;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
