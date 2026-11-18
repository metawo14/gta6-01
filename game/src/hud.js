// The heads-up display: health, cash, wanted stars, weapon and ammo, the job card, a live
// canvas minimap with blips, the speedometer when driving, the city clock and the damage
// vignette. Everything is plain DOM over the canvas except the minimap, which is drawn each
// frame from the same state the simulation uses.
import { CITY, gridLine } from './config.js';

const MAP_RANGE = 205;
const DEFAULT_MINUTES = 19 * 60 + 40;

const pad = (n) => String(n).padStart(2, '0');

// 19:40 -> "19:40"; 22:20 -> "22:20". Falls back to dusk if the clock is ever unusable so a
// broken value can never put "NaN" on screen.
function clockText(minutes) {
  const raw = Number(minutes);
  const safe = Number.isFinite(raw) ? raw : DEFAULT_MINUTES;
  const total = ((safe % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(Math.floor(total % 60))}`;
}

function phaseText(minutes) {
  const hour = Math.floor((((Number(minutes) || DEFAULT_MINUTES) % 1440) + 1440) % 1440 / 60);
  if (hour >= 21 || hour < 5) return 'NIGHT';
  if (hour >= 18) return 'DUSK';
  if (hour >= 12) return 'AFTERNOON';
  return 'MORNING';
}

export class Hud {
  constructor(root) {
    this.root = root;
    this.buildDom();
    this.mapCanvas = this.el('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.starSig = '';
    this.cashShown = -1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  el(id) {
    return this.root.querySelector(`#${id}`);
  }

  buildDom() {
    this.root.innerHTML = `
      <div id="hud-top">
        <div id="hud-left">
          <div id="health-wrap"><div id="health-bar"></div><span id="health-label">100</span></div>
          <div id="cash-row"><span class="muted">CASH</span> <span id="cash">$0</span></div>
          <div id="stars"></div>
        </div>
        <div id="hud-right">
          <div id="clock"><span id="clock-time">19:40</span><span id="clock-phase">DUSK</span></div>
          <div id="weapon">MERIDIAN 9 <span id="ammo">12 / 48</span></div>
        </div>
      </div>
      <div id="objective"><div id="obj-name"></div><div id="obj-step"></div></div>
      <div id="map-wrap">
        <canvas id="minimap" width="230" height="230"></canvas>
        <div id="map-label">PORT MERIDIAN</div>
      </div>
      <div id="speedo"><span id="speed-val">0</span><span id="speed-unit">KM/H</span><div id="gear">P</div></div>
      <div id="prompt"></div>
      <div id="banner"></div>
      <div id="vignette"></div>
      <div id="hitmark"></div>
    `;
    // The clock line is two spans inside #clock: the time and the part of the day.
    const clock = this.el('clock');
    if (clock) clock.style.display = 'flex';
  }

  resize() {
    const size = Math.min(230, Math.floor(window.innerHeight * 0.3));
    const dpr = window.devicePixelRatio || 1;
    this.mapCanvas.width = Math.round(size * dpr);
    this.mapCanvas.height = Math.round(size * dpr);
    this.mapCanvas.style.width = `${size}px`;
    this.mapCanvas.style.height = `${size}px`;
    this.mapDpr = dpr;
  }

  setText(id, text) {
    const node = this.el(id);
    if (node && node.textContent !== text) node.textContent = text;
  }

  update(dt, state) {
    const { player, police, missions, game } = state;
    const health = Math.max(0, Math.round(player.health));

    const bar = this.el('health-bar');
    bar.style.width = `${Math.max(0, Math.min(100, health))}%`;
    bar.style.background = health < 30 ? '#ff4d4d' : health < 60 ? '#ffb43d' : '#54e6c8';
    this.setText('health-label', String(health));

    if (game.cash !== this.cashShown) {
      this.cashShown = game.cash;
      this.setText('cash', `$${Math.max(0, Math.round(game.cash)).toLocaleString('en-US')}`);
    }

    // Wanted stars: lit stars pulse while the heat is fresh.
    const sig = `${police.stars}|${police.heat > 14 ? 1 : 0}`;
    if (sig !== this.starSig) {
      this.starSig = sig;
      let html = '';
      for (let i = 0; i < 5; i++) {
        const on = i < police.stars;
        const pulse = on && police.heat > 14 ? ' pulse' : '';
        html += `<span class="star${on ? ' on' : ''}${pulse}">★</span>`;
      }
      this.el('stars').innerHTML = html;
    }

    const job = missions.current;
    this.setText('obj-name', job ? `JOB ${missions.index + 1}/4 — ${job.name}` : 'STORY COMPLETE');
    this.setText('obj-step', job ? job.steps[Math.min(missions.step, job.steps.length - 1)].text : 'The city is yours.');

    const car = player.inCar;
    const speedo = this.el('speedo');
    if (car) {
      speedo.classList.add('on');
      this.setText('speed-val', String(Math.round(Math.abs(car.speed) * 3.6)));
      this.setText('gear', car.speed < -0.4 ? 'R' : Math.abs(car.speed) < 0.4 ? 'N' : 'D');
    } else {
      speedo.classList.remove('on');
    }

    this.setText('ammo', `${player.ammo} / ${player.reserve}`);
    this.setText('weapon', player.weapon === 'pistol' ? 'MERIDIAN 9' : 'FISTS');

    // The clock reads minutes-of-day from the game (never its THREE.Clock). main.js passes
    // the value in `state.clock`; falling back to the field covers other callers.
    const minutes = state.clock ?? game.clockMinutes;
    this.setText('clock-time', clockText(minutes));
    this.setText('clock-phase', phaseText(minutes));

    this.setText('prompt', game.prompt ?? '');

    const bannerEl = this.el('banner');
    const banner = missions.banner;
    if (banner) {
      bannerEl.className = `show ${banner.kind ?? ''}`;
      bannerEl.innerHTML = `<strong>${banner.text}</strong><span>${banner.sub ?? ''}</span>`;
    } else {
      bannerEl.className = '';
    }

    const vig = this.el('vignette');
    const lowHealth = health < 35 ? 0.3 + Math.sin(performance.now() * 0.006) * 0.12 : 0;
    const flash = game.damageFlash > 0 ? game.damageFlash : 0;
    vig.style.opacity = String(Math.min(1, lowHealth + flash));
    game.damageFlash = Math.max(0, (game.damageFlash ?? 0) - dt * 2);

    this.drawMap(state);
  }

  drawMap(state) {
    const ctx = this.mapCtx;
    const { player, police, missions, vehicles } = state;
    const dpr = this.mapDpr ?? (window.devicePixelRatio || 1);
    const size = this.mapCanvas.width;
    const scale = size / (MAP_RANGE * 2);
    const focus = player.inCar ? player.inCar.pos : player.pos;
    const toMap = (x, z) => [size / 2 + (x - focus.x) * scale, size / 2 + (z - focus.z) * scale];

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0e1420';
    ctx.fillRect(0, 0, size, size);

    // The harbour is a solid band off the east edge of the grid.
    const [wx] = toMap(CITY.waterAt, 0);
    if (wx < size) {
      ctx.fillStyle = '#0a1c2e';
      ctx.fillRect(wx, 0, size - wx, size);
    }

    // Block fills under the road grid, so the map reads as a city and not a wireframe.
    ctx.fillStyle = '#171d2a';
    for (let i = 0; i < CITY.grid; i++) {
      for (let j = 0; j < CITY.grid; j++) {
        const x0 = (i - CITY.grid / 2) * CITY.pitch + CITY.roadWidth / 2;
        const z0 = (j - CITY.grid / 2) * CITY.pitch + CITY.roadWidth / 2;
        const w = CITY.pitch - CITY.roadWidth;
        const [ax, ay] = toMap(x0, z0);
        ctx.fillRect(ax, ay, w * scale, w * scale);
      }
    }

    // Roads.
    ctx.strokeStyle = '#333c52';
    ctx.lineWidth = Math.max(2, CITY.roadWidth * scale);
    ctx.beginPath();
    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      const [mx] = toMap(c, 0);
      const [, mz] = toMap(0, c);
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, size);
      ctx.moveTo(0, mz);
      ctx.lineTo(size, mz);
    }
    ctx.stroke();

    // Traffic as small grey ticks.
    ctx.fillStyle = '#6c7c96';
    for (const car of vehicles.cars) {
      if (car.driver === 'police' || car === player.inCar) continue;
      const [x, y] = toMap(car.pos.x, car.pos.z);
      if (x < 0 || y < 0 || x > size || y > size) continue;
      ctx.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr);
    }

    // Waypoint: a teal ring with a dot in the middle.
    if (missions.marker && missions.beacon.visible) {
      const [x, y] = toMap(missions.marker.x, missions.marker.z);
      ctx.strokeStyle = '#54e6c8';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#a6fff0';
      ctx.beginPath();
      ctx.arc(x, y, 3.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Police blips alternate red and blue like the lightbars.
    const phase = Math.sin(performance.now() * 0.006) > 0;
    for (const unit of police.units) {
      const [x, y] = toMap(unit.car.pos.x, unit.car.pos.z);
      ctx.fillStyle = phase ? '#ff3355' : '#4d8bff';
      ctx.beginPath();
      ctx.arc(x, y, 4.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
    }

    // Player arrow: white, pointing where the player faces.
    const [px, py] = toMap(focus.x, focus.z);
    const heading = player.inCar ? player.inCar.heading : player.heading;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8.5 * dpr);
    ctx.lineTo(5.6 * dpr, 6.4 * dpr);
    ctx.lineTo(0, 3.2 * dpr);
    ctx.lineTo(-5.6 * dpr, 6.4 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Frame and a north tick.
    ctx.strokeStyle = 'rgba(84,230,200,0.45)';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.fillStyle = 'rgba(84,230,200,0.8)';
    ctx.font = `${10 * dpr}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('N', size / 2, 13 * dpr);
  }
}
