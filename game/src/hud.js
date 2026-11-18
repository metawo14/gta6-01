// Port Meridian — the HUD.
// All DOM except the minimap, which is a 2D canvas redrawn every frame. Values are cached so
// the DOM is only touched when something changes, and the star row is cached by star/heat
// state so it does not rebuild every frame.

import { CITY, PLACES, WEAPONS } from './config.js';

const STARS = 5;

export class Hud {
  constructor() {
    this.el = {
      health: document.getElementById('health'),
      healthBar: document.getElementById('health-bar'),
      healthValue: document.getElementById('health-value'),
      cash: document.getElementById('cash'),
      stars: document.getElementById('stars'),
      clock: document.getElementById('clock'),
      phase: document.getElementById('phase'),
      weapon: document.getElementById('weapon-name'),
      ammo: document.getElementById('weapon-ammo'),
      objectiveCard: document.getElementById('objective-card'),
      objectiveJob: document.getElementById('objective-job'),
      objectiveText: document.getElementById('objective-text'),
      minimap: document.getElementById('minimap'),
      speedo: document.getElementById('speedo'),
      speedValue: document.getElementById('speed-value'),
      gear: document.getElementById('gear'),
      prompt: document.getElementById('prompt'),
      banner: document.getElementById('banner'),
      vignette: document.getElementById('vignette'),
      status: document.getElementById('status-line'),
      arrest: document.getElementById('arrest'),
      arrestBar: document.getElementById('arrest-bar'),
    };
    this.mapSize = 230;
    this.canvas = this.el.minimap;
    this.canvas.width = this.mapSize * 2;
    this.canvas.height = this.mapSize * 2;
    this.ctx = this.canvas.getContext('2d');
    this.cache = {
      health: -1, cash: -1, clock: '', phase: '', weapon: '', ammo: '',
      job: '', objective: '', stars: -1, heat: 0, speed: -1, gear: '', prompt: '',
      banner: '', vignette: -1, arrest: -1, status: '',
    };
    this.starFragments = new Map();
    this.bannerErase = 0;
  }

  // --- cached text helpers ----------------------------------------------

  _text(key, value, el, transform) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = transform ? transform(value) : String(value);
  }

  _css(key, value, el, prop) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.style[prop] = value;
  }

  // --- frames ------------------------------------------------------------

  update(game, dt) {
    const p = game.player;
    const health = Math.round(p.health);
    this._text('health', health, this.el.healthValue);
    const ratio = Math.max(0, Math.min(1, p.health / p.maxHealth));
    this._css('healthw', `${(ratio * 100).toFixed(1)}%`, this.el.healthBar, 'width');
    const healthClass = ratio > 0.6 ? '' : ratio > 0.3 ? 'warn' : 'crit';
    if (this.cache.healthClass !== healthClass) {
      this.cache.healthClass = healthClass;
      this.el.health.className = healthClass;
    }

    this._text('cash', game.cash, this.el.cash, (v) => `$${Number(v).toLocaleString('en-US')}`);

    // Clock, with the minutes normalised into a day first.
    const dayMinutes = ((game.clockMinutes % 1440) + 1440) % 1440;
    const hh = Math.floor(dayMinutes / 60);
    const mm = Math.floor(dayMinutes % 60);
    this._text('clock', `${hh}:${String(mm).padStart(2, '0')}`, this.el.clock);
    const phase = dayMinutes < 720 ? 'MORNING'
      : dayMinutes < 1080 ? 'AFTERNOON'
      : dayMinutes < 1260 ? 'DUSK' : 'NIGHT';
    // The phase word depends on the hour, and 21:00-05:00 is NIGHT all through.
    const nightWrap = dayMinutes >= 1260 || dayMinutes < 300;
    const phaseWord = nightWrap ? 'NIGHT' : phase;
    this._text('phase', phaseWord, this.el.phase);
    // Stars: only rebuild when the star or heat state changes.
    const heat = game.police.stars;
    const pulsing = game.police.bustTimer > 0.3 ? 1 : 0;
    const starKey = `${heat}:${pulsing}`;
    if (this.cache.stars !== starKey) {
      this.cache.stars = starKey;
      this._renderStars(heat, pulsing);
    }

    // Weapon chip.
    const weaponName = p.weapon === 'pistol' ? WEAPONS.pistol.name : WEAPONS.fists.name;
    this._text('weapon', weaponName, this.el.weapon);
    if (p.weapon === 'pistol') {
      const ammoText = p.reloading > 0 ? 'reloading' : `${p.magazine} / ${p.reserve}`;
      this._text('ammo', ammoText, this.el.ammo);
    } else {
      this._text('ammo', '—', this.el.ammo);
    }

    // Objective card.
    const job = game.missions.current;
    if (game.missions.completed) {
      this._text('job', 'STORY COMPLETE', this.el.objectiveJob);
      this._text('objective', 'The city is yours', this.el.objectiveText);
    } else if (job) {
      this._text('job', game.missions.jobLabel, this.el.objectiveJob);
      this._text('objective', game.missions.objectiveText, this.el.objectiveText);
    } else {
      this._text('job', 'NO JOB', this.el.objectiveJob);
      this._text('objective', 'The harbour is quiet', this.el.objectiveText);
    }

    // Speedometer: only shown while driving.
    const driving = game.playerCar !== null;
    this.el.speedo.classList.toggle('visible', driving);
    if (driving) {
      const kmh = Math.round(Math.abs(game.playerCar.forwardSpeed) * 3.6);
      this._text('speed', kmh, this.el.speedValue);
      const gear = game.playerCar.forwardSpeed < -0.4 ? 'R'
        : game.input.held('ShiftLeft') && game.playerCar.forwardSpeed < 0.4 ? 'N'
        : Math.abs(game.playerCar.forwardSpeed) < 0.3 ? 'P' : 'D';
      this._text('gear', gear, this.el.gear);
    }

    // Context prompt.
    this._text('prompt', game.prompt || '', this.el.prompt, (v) => v);
    this.el.prompt.classList.toggle('visible', Boolean(game.prompt));

    // Damage vignette: pulses at low health and flashes on impact.
    let vig = 0;
    if (ratio < 0.55) vig = (0.55 - ratio) * 0.9;
    vig = Math.max(vig, game.damageFlash);
    vig = Math.min(1, vig);
    if (Math.abs((this.cache.vignette ?? -1) - vig) > 0.02) {
      this.cache.vignette = vig;
      this.el.vignette.style.opacity = vig.toFixed(2);
    }

    // Arrest progress bar.
    const arrest = game.police.bustTimer / 2.2;
    if (Math.abs((this.cache.arrest ?? -1) - arrest) > 0.01) {
      this.cache.arrest = arrest;
      this.el.arrest.classList.toggle('visible', arrest > 0.02);
      this.el.arrestBar.style.width = `${Math.min(100, arrest * 100).toFixed(0)}%`;
    }

    // Mission-complete banner.
    if (game.missions.bannerTimer > 0) {
      const text = `${game.missions.bannerText}   +$${game.missions.bannerCash}`;
      this._text('banner', text, this.el.banner);
      this.el.banner.classList.add('visible');
      this.bannerErase = game.missions.bannerTimer;
    } else if (this.bannerErase > 0) {
      this.bannerErase = 0;
      this.el.banner.classList.remove('visible');
    }

    // The polite live region the screen reader reads.
    const status = `${game.missions.objectiveText} · ${game.police.stars} stars · $${game.cash}`;
    this._text('status', status, this.el.status);

    this._drawMinimap(game);
  }

  _renderStars(heat, pulsing) {
    const container = this.el.stars;
    const key = `${heat}:${pulsing}`;
    let frag = this.starFragments.get(key);
    if (!frag) {
      frag = document.createDocumentFragment();
      for (let i = 0; i < STARS; i++) {
        const span = document.createElement('span');
        span.className = 'star' + (i < heat ? ' lit' : '') + (pulsing && i < heat ? ' pulse' : '');
        span.textContent = '★';
        frag.appendChild(span);
      }
      this.starFragments.set(key, frag.cloneNode(true));
    }
    container.replaceChildren(frag.cloneNode(true));
  }

  // --- minimap -----------------------------------------------------------

  _drawMinimap(game) {
    const ctx = this.ctx;
    const S = this.canvas.width;
    const half = S / 2;
    const view = 300;                 // world units shown across the map
    const scale = S / view;
    const p = game.player;
    const cx = game.playerCar ? game.playerCar.x : p.x;
    const cz = game.playerCar ? game.playerCar.z : p.z;

    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#16202e';
    ctx.fillRect(0, 0, S, S);

    const toX = (wx) => half + (wx - cx) * scale;
    const toY = (wz) => half + (wz - cz) * scale;

    // Water on the east.
    ctx.fillStyle = '#1a4a66';
    const waterLeft = toX(CITY.seaEdge);
    ctx.fillRect(waterLeft, 0, S - waterLeft, S);

    // Blocks as dark rectangles between roads. Iterate every block and let the transform
    // cull; there are only 144 of them and it keeps the index maths honest.
    ctx.fillStyle = '#4c5a74';
    const pitch = CITY.pitch;
    const blockSize = (pitch - CITY.roadWidth) * scale;
    for (let i = 0; i < CITY.blocks; i++) {
      for (let j = 0; j < CITY.blocks; j++) {
        const bx = (i - CITY.blocks / 2) * pitch + pitch / 2;
        const bz = (j - CITY.blocks / 2) * pitch + pitch / 2;
        const x = toX(bx) - blockSize / 2;
        const y = toY(bz) - blockSize / 2;
        if (x > S || y > S || x + blockSize < 0 || y + blockSize < 0) continue;
        ctx.fillRect(x, y, blockSize, blockSize);
      }
    }

    // Roads: draw as thin lines so the grid reads.
    ctx.strokeStyle = '#27334a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i <= CITY.blocks; i++) {
      const wx = (i - CITY.blocks / 2) * pitch;
      const sx = toX(wx);
      if (sx < -20 || sx > S + 20) continue;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, S);
    }
    for (let j = 0; j <= CITY.blocks; j++) {
      const wz = (j - CITY.blocks / 2) * pitch;
      const sy = toY(wz);
      if (sy < -20 || sy > S + 20) continue;
      ctx.moveTo(0, sy);
      ctx.lineTo(S, sy);
    }
    ctx.stroke();

    // Traffic: grey dots.
    ctx.fillStyle = '#8a93a3';
    for (const car of game.trafficManager.cars) {
      const x = toX(car.car.x);
      const y = toY(car.car.z);
      if (x < 0 || x > S || y < 0 || y > S) continue;
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }

    // Police: flashing red/blue dots. One shared blink value, two hues.
    const blink = Math.floor(game.time * 6) % 2;
    for (let i = 0; i < game.police.units.length; i++) {
      const car = game.police.units[i].car;
      const x = toX(car.x);
      const y = toY(car.z);
      if (x < -6 || x > S + 6 || y < -6 || y > S + 6) continue;
      ctx.fillStyle = (i + blink) % 2 === 0 ? '#ff3b3b' : '#3b6bff';
      ctx.beginPath();
      ctx.arc(x, y, 4.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mission marker: a teal ring.
    const beacon = game.missions.beacon;
    if (beacon) {
      let bx = beacon.x;
      let by = beacon.z;
      // Clamp to the edge so the marker stays visible with an arrow feel.
      const dx = bx - cx;
      const dz = by - cz;
      const dist = Math.hypot(dx, dz);
      const maxWorld = view * 0.44;
      if (dist > maxWorld) {
        bx = cx + (dx / dist) * maxWorld;
        by = cz + (dz / dist) * maxWorld;
      }
      const x = toX(bx);
      const y = toY(by);
      ctx.strokeStyle = '#37f0d0';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(55,240,208,0.25)';
      ctx.fill();
    }

    // A soft outer glow so the map never reads as a black disc.
    ctx.strokeStyle = 'rgba(90,140,190,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(half, half, half - 6, 0, Math.PI * 2);
    ctx.stroke();

    // The player: a white arrow, pointing the way the camera looks (or the car heading).
    ctx.save();
    const px = toX(cx);
    const py = toY(cz);
    ctx.translate(px, py);
    const heading = game.playerCar ? game.playerCar.angle : game.camera.yaw;
    ctx.rotate(-heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North marker at the top.
    ctx.fillStyle = '#d9e2f0';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', half, 24);

    ctx.restore();
  }
}
