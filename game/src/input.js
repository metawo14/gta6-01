// Keyboard, mouse, pointer lock and the shot-preset input overrides.
const KEY_MAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'jump',
  KeyE: 'enter',
  KeyF: 'punch',
  KeyR: 'reload',
  KeyP: 'pause', Escape: 'pause',
  KeyM: 'mute',
  KeyH: 'horn',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.pressed = new Set();
    this.mouseDown = false;
    this.mousePressed = false;
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.dragging = false;
    this.enabled = true;
    this.override = null;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const action = KEY_MAP[e.code];
      if (action && !e.repeat) this.pressed.add(action);
      if (action) {
        this.held.add(action);
        if (e.code === 'Space' || e.code === 'Escape') e.preventDefault();
      }
      if (e.code === 'KeyM') this.pressed.add('mute');
    });
    window.addEventListener('keyup', (e) => {
      const action = KEY_MAP[e.code];
      if (action) this.held.delete(action);
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseDown = false;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.mousePressed = true;
      }
      if (!this.locked) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        if (canvas.requestPointerLock) canvas.requestPointerLock();
      }
    });
    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      } else if (this.dragging) {
        this.dx += e.clientX - (this.lastX ?? e.clientX);
        this.dy += e.clientY - (this.lastY ?? e.clientY);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  down(action) {
    if (this.override) return Boolean(this.override[action]);
    return this.held.has(action);
  }

  hit(action) {
    if (this.override) return Boolean(this.override[action]);
    return this.pressed.has(action);
  }

  get fire() {
    return this.override ? Boolean(this.override.fire) : this.mouseDown;
  }

  axis() {
    const x = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const y = (this.down('back') ? 1 : 0) - (this.down('forward') ? 1 : 0);
    return { x, y };
  }

  consumeMouse() {
    const delta = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return delta;
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed = false;
  }
}
