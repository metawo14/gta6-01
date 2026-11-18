// The HUD: health, cash, wanted stars, the job card, the minimap, the speedo, prompts and the
// damage vignette. Everything is DOM except the minimap, which is a 2D canvas redrawn each frame.
import { CITY, gridLine } from './config.js';

const MAP_RANGE = 205;
const DEFAULT_MINUTES = 19 * 60 + 40;
const starCache = new Map();

function pad(n) {
  return String(n).padStart(2, '0');
}

// Minutes are normalised into a day before use, so a NaN or a negative can never reach the
// clock face. This is the v2 clock fix and it must stay.
function normalise(minutes) {
  const raw = Number(minutes);
  const safe = Number.isFinite(raw) ? raw : DEFAULT_MINUTES;
  return ((safe % 1440) + 1440) % 1440;
}

export function clockText(minutes) {
  const total = normalise(minutes);
  const h = Math.floor(total / 60);
  const m = Math.floor(total % 60);
  return `${pad(h)}:${pad(m)}`;
}

export function phaseText(minutes) {
  const hour = Math.floor(normalise(minutes) / 60);
  if (hour >= 21 || hour < 5) return 'NIGHT';
  if (hour >= 18) return 'DUSK';
  if (hour >= 12) return 'AFTERNOON';
  return 'MORNING';
}

const STAR_BASE = { color: 'rgba(255, 255, 255, 0.16)', glow: '0 2px 6px #000' };
const STAR_LIT = { color: '#ffc23d', glow: '0 0 12px rgba(255, 194, 61, 0.8)' };
const STAR_PULSE = { color: '#fff3c4', glow: '0 0 14px rgba(255, 194, 61, 0.95)' };

const DOM = `
  <div id="hud-top">
    <div id="hud-left">
      <div id="health-wrap"><div id="health-bar"></div><span id="health-label">100</span></div>
      <div id="cash-row"><span class="muted">CASH</span> <span id="cash">$0</span></div>
      <div id="stars"></div>
    </div>
    <div id="hud-right">
      <div id="clock"><span id="clock-time">19:40</span> <span id="clock-phase">DUSK</span></div>
      <div id="weapon">MERIDIAN 9 <span id="ammo">12 / 48</span></div>
    </div>
  </div>
  <div id="objective"><div id="obj-name"></div><div id="obj-step"></div></div>
  <div id="map-wrap"><canvas id="minimap" width="230" height="230"></canvas><div id="map-label">PORT MERIDIAN</div></div>
  <div id="speedo"><span id="speed-val">0</span><span id="speed-unit">KM/H</span><div id="gear">P</div></div>
  <div id="prompt"></div>
  <div id="banner"></div>
  <div id="vignette"></div>
  <div id="hitmark"></div>
`;

export class Hud {
  constructor(root) {
    this.root = root;
    this.nodes = new Map();
    this.textCache = new Map();
    this.buildDom();
    this.mapCanvas = this.el('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.starSig = '';
    this.cashShown = -1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  el(id) {
    let node = this.nodes.get(id);
    if (!node || !node.isConnected) {
      node = this.root.querySelector('#' + id);
      if (node) this.nodes.set(id, node);
    }
    return node;
  }

  buildDom() {
    this.root.innerHTML = DOM;
    const clock = this.el('clock');
    if (clock) clock.style.display = 'flex';
    const weapon = this.el('weapon');
    this.weaponText = weapon ? weapon.firstChild : null;
  }

  resize() {
    const size = Math.min(230, Math.floor(window.innerHeight * 0.3));
    const dpr = window.devicePixelRatio || 1;
    this.mapDpr = dpr;
    this.mapCanvas.width = Math.round(size * dpr);
    this.mapCanvas.height = Math.round(size * dpr);
    this.mapCanvas.style.width = `${size}px`;
    this.mapCanvas.style.height = `${size}px`;
  }

  setText(id, text) {
    const value = text ?? '';
    if (this.textCache.get(id) === value) return;
    this.textCache.set(id, value);
    const node = this.el(id);
    if (node) node.textContent = value;
  }

  update(dt, state) {
    const { player, police, missions, game } = state;
    const now = performance.now();

    const health = Math.max(0, Math.round(player.health));
    const bar = this.el('health-bar');
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, health))}%`;
      bar.style.background = health < 30 ? '#ff4d4d' : health < 60 ? '#ffb43d' : '#54e6c8';
    }
    this.setText('health-label', String(health));

    if (game && game.cash !== this.cashShown) {
      this.cashShown = game.cash;
      this.setText('cash', '$' + Math.max(0, Math.round(game.cash ?? 0)).toLocaleString('en-US'));
    }

    const stars = police?.stars ?? 0;
    const heat = police?.heat ?? 0;
    const sig = `${stars}|${heat > 14 ? 1 : 0}`;
    if (sig !== this.starSig) {
      this.starSig = sig;
      this.drawStars(stars, heat);
    }

    const job = missions?.current ?? null;
    if (job) {
      this.setText('obj-name', `JOB ${missions.index + 1}/4 — ${job.name}`);
      const step = job.steps[Math.min(missions.step, job.steps.length - 1)];
      this.setText('obj-step', step ? step.text : '');
    } else {
      this.setText('obj-name', 'STORY COMPLETE');
      this.setText('obj-step', 'The city is yours.');
    }

    const car = player.inCar;
    const speedo = this.el('speedo');
    if (car) {
      if (speedo) speedo.classList.add('on');
      const speed = Math.abs(car.speed);
      this.setText('speed-val', String(Math.round(speed * 3.6)));
      this.setText('gear', car.speed < -0.4 ? 'R' : speed < 0.4 ? 'N' : 'D');
    } else if (speedo) {
      speedo.classList.remove('on');
    }

    this.setText('ammo', `${player.ammo} / ${player.reserve}`);
    if (this.weaponText) {
      const label = player.weapon === 'pistol' ? 'MERIDIAN 9 ' : 'FISTS ';
      if (this.weaponText.nodeValue !== label) this.weaponText.nodeValue = label;
    }

    const minutes = state.clock ?? game.clockMinutes;
    this.setText('clock-time', clockText(minutes));
    this.setText('clock-phase', phaseText(minutes));
    this.setText('prompt', game.prompt ?? '');

    const banner = this.el('banner');
    if (banner) {
      if (missions?.banner) {
        banner.className = `show ${missions.banner.kind ?? ''}`.trim();
        const html = `<strong>${missions.banner.text}</strong><span>${missions.banner.sub ?? ''}</span>`;
        if (banner.__html !== html) {
          banner.innerHTML = html;
          banner.__html = html;
        }
      } else if (banner.className) {
        banner.className = '';
        banner.__html = '';
      }
    }

    const vignette = this.el('vignette');
    if (vignette) {
      const lowHealth = health < 35 ? 0.3 + Math.sin(now * 0.006) * 0.12 : 0;
      const flash = game.damageFlash > 0 ? game.damageFlash : 0;
      vignette.style.opacity = String(Math.min(1, lowHealth + flash));
      game.damageFlash = Math.max(0, flash - dt * 2);
    }

    this.drawMap(state);
  }

  drawStars(stars, heat) {
    const holder = this.el('stars');
    if (!holder) return;
    const key = `${stars}:${heat > 14 ? 1 : 0}`;
    let frag = starCache.get(key);
    if (!frag) {
      frag = document.createDocumentFragment();
      for (let i = 0; i < 5; i++) {
        const on = i < stars;
        const span = document.createElement('span');
        span.className = 'star' + (on ? ' on' : '') + (on && heat > 14 ? ' pulse' : '');
        span.textContent = '★';
        const look = on ? (heat > 14 ? STAR_PULSE : STAR_LIT) : STAR_BASE;
        span.style.color = look.color;
        span.style.textShadow = look.glow;
        frag.appendChild(span);
      }
      starCache.set(key, frag);
    }
    holder.replaceChildren(frag.cloneNode(true));
  }

  drawMap(state) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const { player, police, missions } = state;
    const dpr = this.mapDpr ?? (window.devicePixelRatio || 1);
    const size = this.mapCanvas.width;
    const scale = size / (MAP_RANGE * 2);
    const focus = player.inCar ? player.inCar.pos : player.pos;
    const half = size / 2;
    const mx = (x) => half + (x - focus.x) * scale;
    const mz = (z) => half + (z - focus.z) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0e1420';
    ctx.fillRect(0, 0, size, size);

    const waterX = mx(CITY.waterAt);
    if (waterX < size) {
      ctx.fillStyle = '#0a1c2e';
      ctx.fillRect(waterX, 0, size - waterX, size);
    }

    // Blocks are the negative space between roads: fill them first.
    ctx.fillStyle = '#171d2a';
    const pitch = CITY.pitch;
    const road = CITY.roadWidth;
    const blockSize = (pitch - road) * scale;
    for (let i = 0; i < CITY.grid; i++) {
      const x0 = (i - CITY.grid / 2) * pitch + road / 2;
      for (let j = 0; j < CITY.grid; j++) {
        const z0 = (j - CITY.grid / 2) * pitch + road / 2;
        ctx.fillRect(mx(x0), mz(z0), blockSize, blockSize);
      }
    }

    ctx.strokeStyle = '#333c52';
    ctx.lineWidth = Math.max(2, road * scale);
    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      ctx.beginPath();
      ctx.moveTo(mx(c), 0);
      ctx.lineTo(mx(c), size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, mz(c));
      ctx.lineTo(size, mz(c));
      ctx.stroke();
    }

    ctx.fillStyle = '#6c7c96';
    const dot = 3 * dpr;
    for (const car of state.vehicles?.cars ?? []) {
      if (car === player.inCar || car.tag === 'police' || car.driver === 'police') continue;
      ctx.fillRect(mx(car.pos.x) - dot / 2, mz(car.pos.z) - dot / 2, dot, dot);
    }

    if (missions?.marker && missions.beacon?.visible) {
      const wx = mx(missions.marker.x);
      const wz = mz(missions.marker.z);
      ctx.strokeStyle = '#54e6c8';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(wx, wz, 9 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#a6fff0';
      ctx.beginPath();
      ctx.arc(wx, wz, 3.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    const phase = Math.sin(performance.now() * 0.006) > 0;
    ctx.fillStyle = phase ? '#ff3355' : '#4d8bff';
    for (const unit of police?.units ?? []) {
      const bx = mx(unit.car.pos.x);
      const bz = mz(unit.car.pos.z);
      ctx.beginPath();
      ctx.arc(bx, bz, 4.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(-player.heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8.5 * dpr);
    ctx.lineTo(5.6 * dpr, 6.4 * dpr);
    ctx.lineTo(0, 3.2 * dpr);
    ctx.lineTo(-5.6 * dpr, 6.4 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(84, 230, 200, 0.45)';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(1, 1, size - 2, size - 2);

    ctx.fillStyle = 'rgba(84, 230, 200, 0.8)';
    ctx.font = `${10 * dpr}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', half, 13 * dpr);
  }
}
