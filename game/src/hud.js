// The HUD: DOM panels for health, cash, stars, clock, weapon and the objective card,
// plus one 2D canvas minimap redrawn each frame. Every value is cached, so the DOM is
// only touched when something changes.

import { CITY, ROADS } from './config.js';

const STAR_CHARS = ['★', '★', '★', '★', '★'];

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {
      healthFill: document.getElementById('health-fill'),
      healthNum: document.getElementById('health-num'),
      cash: document.getElementById('cash'),
      stars: Array.from(document.querySelectorAll('#stars .star')),
      clockTime: document.getElementById('clock-time'),
      clockPhase: document.getElementById('clock-phase'),
      weaponName: document.getElementById('weapon-name'),
      weaponAmmo: document.getElementById('weapon-ammo'),
      objJob: document.getElementById('obj-job'),
      objName: document.getElementById('obj-name'),
      objStep: document.getElementById('obj-step'),
      speedo: document.getElementById('speedo'),
      speedoNum: document.getElementById('speedo-num'),
      gear: document.getElementById('gear'),
      prompt: document.getElementById('prompt'),
      banner: document.getElementById('banner'),
      bannerTitle: document.getElementById('banner-title'),
      bannerSub: document.getElementById('banner-sub'),
      vignette: document.getElementById('vignette'),
      minimap: document.getElementById('minimap'),
      status: document.getElementById('status'),
      hud: document.getElementById('hud'),
    };
    this.cache = {
      health: null,
      cash: null,
      stars: -1,
      clock: '',
      phase: '',
      weapon: '',
      ammo: '',
      job: '',
      name: '',
      step: '',
      speed: null,
      gear: '',
      prompt: '',
      healthBand: '',
    };
    this.starFrags = [];
    this.bannerUntil = 0;
    this.bannerOn = false;
    this.vignetteState = '';
    this.flashUntil = 0;
    this.mctx = this.el.minimap ? this.el.minimap.getContext('2d') : null;
    this.mapSize = 230;
    this._buildMinimapPlan();
    this.hide();
  }

  hide() {
    if (this.el.hud) this.el.hud.style.display = 'none';
  }

  show() {
    if (this.el.hud) this.el.hud.style.display = '';
  }

  _buildMinimapPlan() {
    // the block rectangles are static, so they are computed once
    this.blocks = [];
    for (let i = 0; i < CITY.blocks; i++) {
      for (let j = 0; j < CITY.blocks; j++) {
        const x0 = ROADS[i] + CITY.roadWidth / 2 + CITY.pavement;
        const z0 = ROADS[j] + CITY.roadWidth / 2 + CITY.pavement;
        const w = CITY.pitch - CITY.roadWidth - CITY.pavement * 2;
        this.blocks.push({ x: x0 + w / 2, z: z0 + w / 2, w });
      }
    }
  }

  setHealth(hp, max) {
    const pct = Math.max(0, Math.min(1, hp / max));
    const band = pct < 0.25 ? 'red' : pct < 0.55 ? 'amber' : '';
    const num = Math.round(hp);
    if (this.cache.health !== num) {
      this.cache.health = num;
      this.el.healthNum.textContent = String(num);
      this.el.healthFill.style.width = `${Math.round(pct * 100)}%`;
    }
    if (this.cache.healthBand !== band) {
      this.cache.healthBand = band;
      this.el.healthFill.className = band;
    }
    const vit = pct <= 0.02 ? '' : pct < 0.3 ? 'low' : '';
    this._vignette(vit);
  }

  setCash(cash) {
    if (this.cache.cash === cash) return;
    const gained = this.cache.cash !== null && cash > this.cache.cash;
    this.cache.cash = cash;
    this.el.cash.textContent = `$${cash.toLocaleString('en-US')}`;
    this.el.cash.className = gained ? '' : 'spend';
    setTimeout(() => {
      if (this.el.cash) this.el.cash.className = '';
    }, 900);
  }

  setStars(n, heatHigh) {
    const key = `${n}:${heatHigh ? 1 : 0}`;
    if (this.cache.stars === key) return;
    this.cache.stars = key;
    for (let i = 0; i < this.el.stars.length; i++) {
      const el = this.el.stars[i];
      const lit = i < n;
      const hot = lit && heatHigh;
      const cls = hot ? 'star hot' : lit ? 'star lit' : 'star';
      if (el.className !== cls) el.className = cls;
    }
  }

  setClock(minutes) {
    // normalise into a day first, so a bad value can never reach the clock face
    let m = Number.isFinite(minutes) ? minutes : 0;
    m = ((m % 1440) + 1440) % 1440;
    const hh = Math.floor(m / 60) % 24;
    const mm = Math.floor(m % 60);
    const text = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    let phase;
    if (hh >= 5 && hh < 12) phase = 'MORNING';
    else if (hh >= 12 && hh < 18) phase = 'AFTERNOON';
    else if (hh >= 18 && hh < 21) phase = 'DUSK';
    else phase = 'NIGHT';
    if (this.cache.clock !== text) {
      this.cache.clock = text;
      this.el.clockTime.textContent = text;
    }
    if (this.cache.phase !== phase) {
      this.cache.phase = phase;
      this.el.clockPhase.textContent = phase;
    }
  }

  setWeapon(name, ammoLabel) {
    if (this.cache.weapon !== name) {
      this.cache.weapon = name;
      this.el.weaponName.textContent = name;
    }
    if (this.cache.ammo !== ammoLabel) {
      this.cache.ammo = ammoLabel;
      this.el.weaponAmmo.textContent = ammoLabel;
      const mag = parseInt(ammoLabel.split('/')[0], 10);
      this.el.weaponAmmo.className = Number.isFinite(mag) && mag <= 3 ? 'low' : '';
    }
  }

  setObjective(jobLabel, name, step) {
    if (this.cache.job !== jobLabel) {
      this.cache.job = jobLabel;
      this.el.objJob.textContent = jobLabel;
    }
    if (this.cache.name !== name) {
      this.cache.name = name;
      this.el.objName.textContent = name;
    }
    if (this.cache.step !== step) {
      this.cache.step = step;
      this.el.objStep.textContent = step;
    }
  }

  setSpeed(kmh, gear, show) {
    if (show) {
      this.el.speedo.classList.add('show');
      const n = Math.round(kmh);
      if (this.cache.speed !== n) {
        this.cache.speed = n;
        this.el.speedoNum.textContent = String(n);
      }
      if (this.cache.gear !== gear) {
        this.cache.gear = gear;
        this.el.gear.textContent = gear;
      }
    } else {
      this.el.speedo.classList.remove('show');
      this.cache.speed = null;
    }
  }

  setPrompt(text) {
    const t = text || '';
    if (this.cache.prompt === t) return;
    this.cache.prompt = t;
    if (!t) {
      this.el.prompt.classList.remove('show');
      return;
    }
    this.el.prompt.textContent = t;
    this.el.prompt.classList.add('show');
  }

  showBanner(title, sub, seconds = 2.6) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub || '';
    this.el.banner.classList.add('show');
    this.bannerOn = true;
    this.bannerUntil = performance.now() + seconds * 1000;
  }

  hideBanner() {
    this.el.banner.classList.remove('show');
    this.bannerOn = false;
  }

  _vignette(state) {
    let s = state;
    if (performance.now() < this.flashUntil) s = s ? `${s} hit` : 'hit';
    if (this.vignetteState === s) return;
    this.vignetteState = s;
    this.el.vignette.className = s;
  }

  flashDamage() {
    this.flashUntil = performance.now() + 260;
    this.el.vignette.className = this.cache.health < 30 ? 'low hit' : 'hit';
    this.vignetteState = this.el.vignette.className;
  }

  setStatus(text) {
    if (this.cache.status === text) return;
    this.cache.status = text;
    this.el.status.textContent = text;
  }

  tick(now) {
    if (this.bannerOn && now > this.bannerUntil) this.hideBanner();
    if (this.flashUntil && now > this.flashUntil) {
      this.flashUntil = 0;
      const pct = this.game.player ? this.game.player.health / this.game.player.maxHealth : 1;
      this.vignetteState = pct < 0.3 ? 'low' : '';
      this.el.vignette.className = this.vignetteState;
    }
  }

  // ---------- minimap ----------

  drawMinimap(state) {
    const ctx = this.mctx;
    if (!ctx) return;
    const S = this.mapSize;
    const R = 118; // world metres the map covers on each side
    const cx = S / 2;
    const cy = S / 2;
    const focus = state.focus;
    const scale = S / (R * 2);
    const toX = (x) => cx + (x - focus.x) * scale;
    const toY = (z) => cy + (z - focus.z) * scale;

    ctx.clearRect(0, 0, S, S);
    // ground
    ctx.fillStyle = '#0b1119';
    ctx.fillRect(0, 0, S, S);

    // the sea on the east
    const seaX = toX(CITY.seaWall);
    ctx.fillStyle = '#123246';
    ctx.fillRect(Math.max(0, seaX), 0, S, S);
    ctx.fillStyle = 'rgba(90,200,230,0.12)';
    ctx.fillRect(Math.max(0, seaX), 0, S, S);

    // blocks between roads
    ctx.fillStyle = '#1b2432';
    for (const b of this.blocks) {
      const w = b.w * scale;
      const x = toX(b.x - b.w / 2);
      const y = toY(b.z - b.w / 2);
      if (x + w < 0 || y + w < 0 || x > S || y > S) continue;
      ctx.fillRect(x, y, w, w);
    }

    // roads once more as a faint grid so the streets read
    ctx.strokeStyle = 'rgba(120,160,190,0.14)';
    ctx.lineWidth = Math.max(1, CITY.roadWidth * scale * 0.9);
    for (const r of ROADS) {
      ctx.beginPath();
      ctx.moveTo(toX(r), 0);
      ctx.lineTo(toX(r), S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, toY(r));
      ctx.lineTo(S, toY(r));
      ctx.stroke();
    }

    // traffic
    ctx.fillStyle = 'rgba(190,205,220,0.72)';
    for (const car of state.traffic) {
      if (car.x > CITY.seaWall) continue;
      ctx.beginPath();
      ctx.arc(toX(car.x), toY(car.z), 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // police, flashing red and blue
    for (const p of state.police) {
      ctx.fillStyle = state.flashRed ? '#ff4a3d' : '#ff9a90';
      ctx.beginPath();
      ctx.arc(toX(p.x), toY(p.z), 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = state.flashRed ? 'rgba(60,110,255,0.55)' : '#4a86ff';
      ctx.beginPath();
      ctx.arc(toX(p.x) + 2.4, toY(p.z) - 2.4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // the mission marker: a teal ring
    if (state.marker) {
      const mx = toX(state.marker.x);
      const my = toY(state.marker.z);
      ctx.strokeStyle = '#38f0dc';
      ctx.lineWidth = 2.2;
      const pulse = 7 + Math.sin(state.now * 0.004) * 2;
      ctx.beginPath();
      ctx.arc(mx, my, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(56,240,220,0.28)';
      ctx.beginPath();
      ctx.arc(mx, my, pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // the player's white arrow
    if (state.player) {
      const px = toX(state.player.x);
      const py = toY(state.player.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-state.player.heading);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5.6, 6);
      ctx.lineTo(0, 3.2);
      ctx.lineTo(-5.6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // edge frame
    ctx.strokeStyle = 'rgba(140,200,230,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, S - 2, S - 2);
  }
}
