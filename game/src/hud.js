// The HUD: health, cash, wanted stars, weapon and ammo, the mission objective, a live
// canvas minimap with blips, the speedometer, the clock and the vignette effects.
import { CITY, gridLine, CAR_TYPES } from './config.js';

const MAP_RANGE = 210;

export class Hud {
  constructor(root) {
    this.root = root;
    this.buildDom();
    this.mapCanvas = this.el('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.flash = 0;
    this.lastCash = 0;
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
          <div id="clock">19:40</div>
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
  }

  resize() {
    const size = Math.min(230, Math.floor(window.innerHeight * 0.3));
    this.mapCanvas.width = size * (window.devicePixelRatio || 1);
    this.mapCanvas.height = size * (window.devicePixelRatio || 1);
    this.mapCanvas.style.width = `${size}px`;
    this.mapCanvas.style.height = `${size}px`;
  }

  setText(id, text) {
    const node = this.el(id);
    if (node && node.textContent !== text) node.textContent = text;
  }

  update(dt, state) {
    const { player, police, missions, game } = state;
    const health = Math.max(0, Math.round(player.health));
    this.el('health-bar').style.width = `${(health / 100) * 100}%`;
    this.el('health-bar').style.background = health < 30 ? '#ff4d4d' : health < 60 ? '#ffb43d' : '#54e6c8';
    this.setText('health-label', String(health));
    this.setText('cash', `$${game.cash.toLocaleString('en-US')}`);

    let stars = '';
    for (let i = 0; i < 5; i++) {
      const on = i < police.stars;
      const pulse = on && police.heat > 14 && Math.sin(performance.now() * 0.012) > 0;
      stars += `<span class="star ${on ? 'on' : ''} ${pulse ? 'pulse' : ''}">★</span>`;
    }
    const starBox = this.el('stars');
    if (starBox.dataset.sig !== `${police.stars}-${Math.floor(police.heat)}`) {
      starBox.dataset.sig = `${police.stars}-${Math.floor(police.heat)}`;
      starBox.innerHTML = stars;
    }

    const m = missions.current;
    this.setText('obj-name', m ? `JOB ${missions.index + 1}/4 — ${m.name}` : 'STORY COMPLETE');
    this.setText('obj-step', m ? m.steps[Math.min(missions.step, m.steps.length - 1)].text : 'The city is yours.');

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
    const mins = Math.floor(game.clock % (24 * 60));
    this.setText('clock', `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);

    const action = game.prompt;
    this.setText('prompt', action ?? '');

    const banner = missions.banner;
    const bannerEl = this.el('banner');
    if (banner) {
      bannerEl.className = `show ${banner.kind}`;
      bannerEl.innerHTML = `<strong>${banner.text}</strong><span>${banner.sub ?? ''}</span>`;
    } else {
      bannerEl.className = '';
    }

    const vig = this.el('vignette');
    const low = health < 35 ? 0.35 + Math.sin(performance.now() * 0.006) * 0.14 : 0;
    vig.style.opacity = String(Math.min(1, low + (game.damageFlash > 0 ? game.damageFlash : 0)));
    game.damageFlash = Math.max(0, (game.damageFlash ?? 0) - dt * 2);

    this.drawMap(state);
  }

  drawMap(state) {
    const ctx = this.mapCtx;
    const { player, police, missions, vehicles } = state;
    const size = this.mapCanvas.width;
    const dpr = window.devicePixelRatio || 1;
    const s = size / (MAP_RANGE * 2);
    const focus = player.inCar ? player.inCar.pos : { x: player.pos.x, z: player.pos.z };
    ctx.save();
    ctx.scale(1, 1);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#101520';
    ctx.fillRect(0, 0, size, size);

    const toMap = (x, z) => [size / 2 + (x - focus.x) * s, size / 2 + (z - focus.z) * s];

    // Water on the east edge.
    const [wx] = toMap(CITY.waterAt, 0);
    if (wx < size) {
      ctx.fillStyle = '#0a1c2e';
      ctx.fillRect(wx, 0, size - wx, size);
    }

    // Road grid.
    ctx.strokeStyle = '#2d3446';
    ctx.lineWidth = Math.max(2, CITY.roadWidth * s);
    ctx.beginPath();
    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      const [mx, my] = toMap(c, 0);
      const [, mz] = toMap(0, c);
      ctx.moveTo(mx, 0); ctx.lineTo(mx, size);
      ctx.moveTo(0, mz); ctx.lineTo(size, mz);
    }
    ctx.stroke();

    ctx.strokeStyle = '#151a26';
    ctx.lineWidth = Math.max(0.5, 0.6 * dpr);
    ctx.beginPath();
    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      const [mx] = toMap(c, 0);
      const [, mz] = toMap(0, c);
      ctx.moveTo(mx, 0); ctx.lineTo(mx, size);
      ctx.moveTo(0, mz); ctx.lineTo(size, mz);
    }
    ctx.stroke();

    // Traffic: dim dots.
    ctx.fillStyle = '#6b7a94';
    for (const car of vehicles.cars) {
      if (car.driver === 'police' || car === player.inCar) continue;
      const [x, y] = toMap(car.pos.x, car.pos.z);
      if (x < 0 || y < 0 || x > size || y > size) continue;
      ctx.fillRect(x - 1.6 * dpr, y - 1.6 * dpr, 3.2 * dpr, 3.2 * dpr);
    }

    // Waypoint.
    if (missions.marker && missions.beacon.visible) {
      const [x, y] = toMap(missions.marker.x, missions.marker.z);
      ctx.strokeStyle = '#54e6c8';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#54e6c8';
      ctx.beginPath();
      ctx.arc(x, y, 3.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Police blips: flashing red/blue.
    const t = performance.now() * 0.006;
    for (const unit of police.units) {
      const [x, y] = toMap(unit.car.pos.x, unit.car.pos.z);
      ctx.fillStyle = Math.sin(t) > 0 ? '#ff3355' : '#4488ff';
      ctx.beginPath();
      ctx.arc(x, y, 4.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player arrow.
    const [px, py] = toMap(focus.x, focus.z);
    const heading = player.inCar ? player.inCar.heading : player.heading;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8 * dpr);
    ctx.lineTo(5.4 * dpr, 6 * dpr);
    ctx.lineTo(0, 3 * dpr);
    ctx.lineTo(-5.4 * dpr, 6 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Frame.
    ctx.strokeStyle = 'rgba(84,230,200,0.45)';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.restore();
  }
}
