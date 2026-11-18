// The game: a fixed-step loop over the modes title / play / paused / busted / wasted,
// the camera, the crime feed, saving, combat and the wiring of every other module.

import * as THREE from 'three';
import {
  CITY,
  CLOCK,
  COLORS,
  SAVE_KEY,
  SPAWN,
  MISSION_TARGETS,
  PLAYER,
  WEAPONS,
  CAR_SPECS,
} from './config.js';
import { seededFromQuery, clamp, damp, wrapAngle } from './random.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { World } from './world.js';
import { VehicleManager } from './vehicles.js';
import { Player } from './player.js';
import { TrafficSystem } from './traffic.js';
import { PoliceSystem } from './police.js';
import { MissionSystem } from './missions.js';
import { Hud } from './hud.js';

const RESPAWN = { x: 150, z: -150 };
const BUSTED_COST = 150;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.params = new URLSearchParams(window.location.search);
    this.seed = seededFromQuery(window.location.search, CITY.seed);
    this.shot = this.params.get('shot');

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.fog, 90, 520);
    this.scene.background = new THREE.Color(COLORS.skyTop);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 1400);
    this.camera.position.set(0, 6, -12);

    this.audio = new AudioEngine();
    this.input = new Input(canvas);
    this.input.onFirstGesture = () => this.audio.init();

    this.world = new World(this.scene, this.seed);
    this.cars = new VehicleManager(this.scene, this.world, {
      onCrash: (car, impact) => this.onCarCrash(car, impact),
      onWreck: (car) => this.onCarWreck(car),
      onPropHit: (car, prop) => this.onPropHit(car, prop),
      onCarHit: (other, impact) => this.onCarHit(other, impact),
      audio: this.audio,
    });
    this.player = new Player(this.scene, this.world, this.audio);
    this.player.car = null;
    this.traffic = new TrafficSystem(this.scene, this.world, this.cars, this.audio);
    this.police = new PoliceSystem(this.scene, this.world, this.cars, this.audio);
    this.police.onBusted = () => this.bust();
    this.hud = new Hud(this);
    this.missions = new MissionSystem(this.scene, this.world, this);

    this.mode = 'title';
    this.pose = 'foot';
    this.cash = 250;
    this.clockMinutes = CLOCK.startMinutes;
    this.crimeAt = null;
    this.crimeTimer = 0;
    this.cameraYaw = 0;
    this.cameraPitch = -0.12;
    this.camPos = new THREE.Vector3(0, 4, -10);
    this.camLook = new THREE.Vector3(0, 1.4, 0);
    this.shake = 0;
    this.shakeT = 0;
    this.lastTime = 0;
    this.acc = 0;
    this.frame = 0;
    this.ticks = 0;
    this.now = 0;
    this.paused = false;
    this.endInfo = null;
    this.shotScript = null;
    this.shotTicks = 0;
    this.timeScale = 1;
    this.muteShown = false;

    this.bindResize();
    this.bindOverlay();
    this.bindKeys();
    this.showTitle();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);

    window.__game = this;
    window.__shotReady = false;
    window.__shotError = null;
    window.addEventListener('error', (e) => {
      window.__shotError = String(e.message || e) + ' @ ' + String((e.error && e.error.stack) || e.filename + ':' + e.lineno);
    });

    if (this.shot) {
      import('./shots.js')
        .then((mod) => {
          this.traffic.spawnAll(24, 34);
          if (!mod.stageShot(this, this.shot)) {
            this.startFresh();
            window.__shotReady = true;
          }
        })
        .catch((err) => {
          window.__shotError = String(err && err.message ? err.message : err);
          this.startFresh();
          window.__shotReady = true;
        });
    }
  }

  // ---------- wiring ----------

  bindResize() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
  }

  bindKeys() {
    // the actions that are one-shot go through the input object each frame
    this.overlayButtons = [];
  }

  bindOverlay() {
    this.overlay = document.getElementById('overlay');
    this.card = document.getElementById('overlay-card');
    this.overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      this.audio.init();
      this.overlayAction(act);
    });
  }

  overlayAction(act) {
    if (act === 'start') this.startFresh();
    else if (act === 'continue') this.continueSave();
    else if (act === 'resume') this.resume();
    else if (act === 'save') this.saveGame(true);
    else if (act === 'restart') this.startFresh();
    else if (act === 'walkout') this.respawn('busted');
    else if (act === 'getup') this.respawn('wasted');
    else if (act === 'title') this.showTitle();
  }

  // ---------- title / overlays ----------

  storyHtml() {
    return `<p class="story">The docks took your brother's boat, his name and nearly you. The Port Authority runs
      this city on <b>bribes and bad coffee</b>; the crews run it on nerve. You have two hundred and fifty in
      your pocket, a pistol with a full magazine, and a lock-up on Kestrel Row that nobody else wanted.
      Four jobs stand between the harbour mud and the top of the pile.</p>`;
  }

  controlsHtml() {
    return `
      <div class="keys">
        <kbd>W A S D</kbd><span>move · drive</span>
        <kbd>Mouse</kbd><span>look · aim</span>
        <kbd>Shift</kbd><span>sprint · handbrake</span>
        <kbd>Space</kbd><span>jump</span>
        <kbd>E</kbd><span>take or leave a car</span>
        <kbd>Click</kbd><span>fire</span>
        <kbd>F</kbd><span>punch</span>
        <kbd>R</kbd><span>reload</span>
        <kbd>1 · 2</kbd><span>pistol · fists</span>
        <kbd>H</kbd><span>horn</span>
        <kbd>P</kbd><span>pause &amp; save</span>
        <kbd>M</kbd><span>mute</span>
      </div>`;
  }

  showTitle() {
    this.mode = 'title';
    this.hud.hide();
    const save = this.readSave();
    const best = save ? `<div class="save">BEST SAVE — job ${Math.min(4, (save.missionIndex ?? 0) + 1)} of 4 · <b>$${(save.cash ?? 0).toLocaleString('en-US')}</b> · ${save.stamp ? new Date(save.stamp).toLocaleString() : 'unknown time'}</div>` : '';
    this.card.innerHTML = `
      <div class="kicker">A DUSK CITY CRIME STORY</div>
      <h1>PORT MERIDIAN</h1>
      <div class="sub">ROOKIE TO KINGPIN · FOUR JOBS · ONE HARBOUR</div>
      ${this.storyHtml()}
      <div class="cols">
        <div><h2>Controls</h2>${this.controlsHtml()}</div>
        <div><h2>The Four Jobs</h2>
          <div class="keys">
            <kbd>01</kbd><span>First Wheels — steal a car, reach the lock-up</span>
            <kbd>02</kbd><span>Payback — wreck the runner's sports car</span>
            <kbd>03</kbd><span>Hot Package — marina to the north quay</span>
            <kbd>04</kbd><span>The Big Score — lift, shake the tail, hide</span>
          </div>
        </div>
      </div>
      ${best}
      <div class="buttons">
        <button class="act" data-act="start">START</button>
        <button class="act ghost ${save ? '' : 'hidden'}" data-act="continue">CONTINUE</button>
      </div>`;
    this.overlay.classList.add('show');
  }

  startFresh() {
    this.cash = 250;
    this.player.health = PLAYER.health;
    this.player.mag = WEAPONS.pistol.mag;
    this.player.reserve = WEAPONS.pistol.reserve;
    this.player.weapon = 'pistol';
    this.player.gunGroup.visible = true;
    this.clockMinutes = CLOCK.startMinutes;
    this.police.setStars(0);
    this.police.despawnAll();
    this.cars.clearTraffic();
    this.traffic.spawnAll(24, 34);
    this.player.teleport(SPAWN.x, SPAWN.z, SPAWN.heading);
    this.player.car = null;
    this.pose = 'foot';
    this.player.setVisible(true);
    this.missions.start(0);
    this.enterPlay();
  }

  continueSave() {
    const s = this.readSave();
    if (!s) {
      this.startFresh();
      return;
    }
    this.cash = s.cash ?? 250;
    this.clockMinutes = s.clockMinutes ?? CLOCK.startMinutes;
    this.player.health = clamp(s.health ?? PLAYER.health, 20, PLAYER.health);
    this.player.teleport(s.x ?? SPAWN.x, s.z ?? SPAWN.z, s.heading ?? SPAWN.heading);
    this.police.setStars(s.stars ?? 0);
    this.cars.clearTraffic();
    this.traffic.spawnAll(24, 34);
    this.missions.start(s.missionIndex ?? 0);
    this.missions.step = Math.min(s.step ?? 0, this.missions.current.steps.length - 1);
    this.missions.updateBeacon();
    this.player.car = null;
    this.pose = 'foot';
    this.enterPlay();
  }

  enterPlay() {
    this.mode = 'play';
    this.overlay.classList.remove('show');
    this.hud.show();
    this.hud.hideBanner();
    this.input.setOverride(!!this.shot || this.playtestMode);
    this.cameraYaw = this.player.heading;
    this.snapCamera();
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.saveGame(false);
    this.card.innerHTML = `
      <div class="kicker">PAUSED</div>
      <h1 style="font-size:38px">PORT MERIDIAN</h1>
      <div class="save">Your game is saved automatically. Cash <b>$${this.cash.toLocaleString('en-US')}</b> · job ${Math.min(4, this.missions.index + 1)} of 4.</div>
      <div class="buttons">
        <button class="act" data-act="resume">RESUME</button>
        <button class="act ghost" data-act="save">SAVE</button>
        <button class="act ghost" data-act="restart">RESTART</button>
      </div>`;
    this.overlay.classList.add('show');
  }

  resume() {
    this.overlay.classList.remove('show');
    this.mode = 'play';
  }

  bust() {
    if (this.mode !== 'play') return;
    this.mode = 'busted';
    this.cash = Math.max(0, this.cash - BUSTED_COST);
    this.audio.busted();
    this.endInfo = 'busted';
    this.player.car = null;
    this.pose = 'foot';
    this.player.setVisible(true);
    this.card.innerHTML = `
      <div class="end-busted">
        <div class="kicker">THE HARBOUR POLICE HAVE YOU</div>
        <div class="end-title">BUSTED</div>
        <div class="save">They take <b>$${BUSTED_COST}</b> out of your pocket and a photograph of your face. Cash now <b>$${this.cash}</b>.</div>
        <div class="buttons"><button class="act" data-act="walkout">WALK OUT</button></div>
      </div>`;
    this.overlay.classList.add('show');
  }

  waste(reason) {
    if (this.mode !== 'play') return;
    this.mode = 'wasted';
    this.audio.busted();
    this.endInfo = reason || 'wasted';
    this.player.car = null;
    this.pose = 'foot';
    this.player.setVisible(true);
    this.card.innerHTML = `
      <div class="end-wasted">
        <div class="kicker">THE CITY SPITS YOU OUT</div>
        <div class="end-title">WASTED</div>
        <div class="save">${reason || 'You went down in the street.'} The north quay is quiet at this hour.</div>
        <div class="buttons"><button class="act" data-act="getup">GET UP</button></div>
      </div>`;
    this.overlay.classList.add('show');
  }

  respawn(kind) {
    this.cash = this.cash; // busted already took its cut
    this.player.health = PLAYER.health;
    this.player.mag = WEAPONS.pistol.mag;
    this.player.reserve = WEAPONS.pistol.reserve;
    this.player.teleport(RESPAWN.x, RESPAWN.z, Math.PI);
    this.player.car = null;
    this.pose = 'foot';
    this.player.setVisible(true);
    this.police.setStars(0);
    this.police.despawnAll();
    this.cars.clearTraffic();
    this.traffic.spawnAll(24, 34);
    this.endInfo = null;
    this.overlay.classList.remove('show');
    this.mode = 'play';
    this.hud.show();
    this.cameraYaw = Math.PI;
    this.snapCamera();
  }

  // ---------- save ----------

  readSave() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch {
      return null;
    }
  }

  saveGame(showFeedback) {
    const p = this.player;
    const pos = p.car ? { x: p.car.x, z: p.car.z } : { x: p.x, z: p.z };
    const payload = {
      version: 1,
      cash: this.cash,
      health: p.health,
      missionIndex: this.missions.index,
      step: this.missions.step,
      x: Math.round(pos.x * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
      heading: Math.round(p.heading * 1000) / 1000,
      clockMinutes: this.clockMinutes,
      stars: this.police.stars,
      stamp: Date.now(),
    };
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      this.lastSave = payload;
      return true;
    } catch {
      // private mode: storage throws, and the game carries on without a save
      this.lastSave = payload;
      return false;
    }
  }

  // ---------- crimes ----------

  addCash(n) {
    this.cash = Math.max(0, this.cash + Math.round(n));
    return this.cash;
  }

  showBanner(title, sub, seconds) {
    this.hud.showBanner(title, sub, seconds);
  }

  raiseWanted(n) {
    this.police.raise(n);
    this.crimeTimer = 13;
    this.crimeAt = { x: this.player.car ? this.player.car.x : this.player.x, z: this.player.car ? this.player.car.z : this.player.z, t: 6 };
  }

  coolWanted(n) {
    this.police.cool(n);
  }

  onCarCrash(car, impact) {
    const isPlayer = car === this.cars.playerCar;
    if (isPlayer) {
      this.shake = Math.min(1, 0.3 + impact / 12);
      this.shakeT = 0;
      this.hud.flashDamage();
      this.audio.crash(clamp(impact / 12, 0.3, 1.4));
    } else if (Math.hypot(car.x - this.player.x, car.z - this.player.z) < 40) {
      this.audio.crash(clamp(impact / 20, 0.15, 0.7));
    }
  }

  onPropHit(car, prop) {
    if (car === this.cars.playerCar) {
      this.shake = Math.max(this.shake, 0.18);
      this.audio.crash(0.2);
    }
  }

  onCarHit(other, impact) {
    this.hud.flashDamage();
    this.shake = Math.max(this.shake, Math.min(0.9, impact / 16));
    this.audio.crash(clamp(impact / 14, 0.25, 1.1));
    if (other && other.driver === 'police') {
      // ramming a cruiser is a crime against the law
      this.raiseWanted(1);
    }
  }

  onCarWreck(car) {
    if (car === this.cars.playerCar) {
      const p = this.player;
      p.health = Math.max(1, p.health - 25);
      this.hurtPlayer(1); // forces the eject below through the same path
      this.ejectPlayer(true);
      this.waste('Your car went up in flames with you still in it.');
    }
  }

  // ---------- player actions ----------

  enterCar(car) {
    if (!car || car.wrecked) return false;
    const wasPolice = car.type === 'police';
    this.player.car = car;
    this.player.setVisible(false);
    car.driver = 'player';
    this.cars.playerCar = car;
    this.pose = 'driving';
    this.cameraYaw = car.heading;
    // stealing a civilian car is one star, a cruiser two
    if (car.driver === 'player' && !car.safeToTake) {
      this.raiseWanted(wasPolice ? 2 : 1);
    }
    car.safeToTake = false;
    this.snapCamera();
    return true;
  }

  exitCar() {
    const car = this.player.car;
    if (!car) return false;
    car.driver = null;
    this.cars.playerCar = null;
    this.player.car = null;
    const side = car.heading + Math.PI / 2;
    let x = car.x + Math.cos(side) * (car.halfWidth + 1.2);
    let z = car.z - Math.sin(side) * (car.halfWidth + 1.2);
    const r = this.world.resolveCircle(x, z, PLAYER.radius);
    this.player.teleport(r.x, r.z, car.heading);
    this.player.setVisible(true);
    this.pose = 'foot';
    car.vx *= 0.2;
    car.vz *= 0.2;
    return true;
  }

  ejectPlayer(carBurning) {
    const car = this.player.car;
    if (!car) return;
    car.driver = null;
    this.cars.playerCar = null;
    this.player.car = null;
    this.pose = 'foot';
    this.player.setVisible(true);
    this.player.teleport(car.x + 2.4, car.z + 2.4, car.heading);
  }

  hurtPlayer(amount) {
    if (this.mode !== 'play') return;
    this.player.hurt(amount);
    this.hud.flashDamage();
    if (this.player.health <= 0) this.waste('You bled out in a back street.');
  }

  fireWeapon() {
    const p = this.player;
    const w = WEAPONS[p.weapon];
    if (!p.canFire()) {
      if (p.weapon === 'pistol' && p.mag === 0) p.startReload();
      return;
    }
    p.consumeShot();
    if (p.weapon !== 'pistol') return;

    const yaw = this.cameraYaw;
    const origin = new THREE.Vector3(
      p.x + Math.sin(yaw) * 0.5,
      1.45,
      p.z + Math.cos(yaw) * 0.5,
    );
    const dir = new THREE.Vector3(Math.sin(yaw), -0.04, Math.cos(yaw)).normalize();
    this.tracer(origin, dir, w.range);
    this.shake = Math.max(this.shake, 0.12);

    // a generous aim cone: nearest pedestrian, then police cars in front
    let best = null;
    let bestScore = Infinity;
    const cosLimit = Math.cos(0.42);
    for (const ped of this.traffic.peds) {
      if (ped.down > 0.2) continue;
      const dx = ped.x - p.x;
      const dz = ped.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range || d < 0.4) continue;
      const dot = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
      if (dot < cosLimit) continue;
      const score = d * (2 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'ped', ped, d };
      }
    }
    for (const car of this.cars.cars) {
      if (car.driver === 'player') continue;
      const dx = car.x - p.x;
      const dz = car.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range) continue;
      const dot = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / (d || 1);
      if (dot < cosLimit) continue;
      if (car.type !== 'police' && car.driver !== null) continue;
      const score = d * (2 - dot) + 2;
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'car', car, d };
      }
    }
    if (best) {
      if (best.kind === 'ped') {
        this.traffic.knockDown(best.ped, Math.sin(yaw), Math.cos(yaw), 1.2);
        this.traffic.scatter(best.ped.x, best.ped.z, 30, 1.4);
        this.raiseWanted(2);
      } else {
        best.car.damage(w.damage);
        this.raiseWanted(best.car.type === 'police' ? 2 : 1);
      }
    }
    // bystanders scatter from gunfire anyway
    this.traffic.scatter(p.x, p.z, 26, 0.8);
  }

  tracer(origin, dir, range) {
    const end = origin.clone().add(dir.clone().multiplyScalar(range * 0.7));
    const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffe2a8,
      transparent: true,
      opacity: 0.85,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    const born = performance.now();
    const fade = () => {
      const t = (performance.now() - born) / 110;
      if (t >= 1) {
        this.scene.remove(line);
        geo.dispose();
        mat.dispose();
        return;
      }
      mat.opacity = 0.85 * (1 - t);
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  punchAction() {
    const p = this.player;
    if (!p.punch()) return;
    const near = this.traffic.nearestPed(p.x, p.z, 2.6);
    if (near) {
      const dx = near.ped.x - p.x;
      const dz = near.ped.z - p.z;
      this.traffic.knockDown(near.ped, dx, dz, 1);
      this.traffic.scatter(near.ped.x, near.ped.z, 22, 1);
      this.raiseWanted(2);
    }
    // punching a cruiser counts too
    for (const car of this.cars.cars) {
      if (car.type === 'police' && Math.hypot(car.x - p.x, car.z - p.z) < 3) {
        car.damage(6);
        this.raiseWanted(1);
        break;
      }
    }
  }

  // ---------- camera ----------

  snapCamera() {
    const car = this.player.car;
    if (car) {
      const back = 8.2;
      const up = 3.5;
      this.camPos.set(
        car.x - Math.sin(car.heading) * back,
        up,
        car.z - Math.cos(car.heading) * back,
      );
      this.camLook.set(car.x, 1.3, car.z);
    } else {
      this.camPos.set(
        this.player.x - Math.sin(this.cameraYaw) * 6.5,
        3.1,
        this.player.z - Math.cos(this.cameraYaw) * 6.5,
      );
      this.camLook.set(this.player.x, 1.5, this.player.z);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  updateCamera(dt) {
    if (this.shotCamera) {
      // the staged frame is posed by staging, not by easing
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      return;
    }
    const car = this.player.car;
    const mouse = this.input.takeMouse();
    if (car) {
      this.cameraYaw = car.heading;
      const sp = Math.hypot(car.vx, car.vz);
      const back = 8.0 + sp * 0.1;
      const up = 3.3 + sp * 0.022;
      const want = new THREE.Vector3(
        car.x - Math.sin(this.cameraYaw) * back,
        up,
        car.z - Math.cos(this.cameraYaw) * back,
      );
      this.camPos.lerp(want, 1 - Math.exp(-7 * dt));
      this.camLook.lerp(new THREE.Vector3(car.x + Math.sin(car.heading) * 2.2, 1.25, car.z + Math.cos(car.heading) * 2.2), 1 - Math.exp(-10 * dt));
    } else {
      this.cameraYaw = wrapAngle(this.cameraYaw - mouse.dx * 0.0032);
      this.cameraPitch = clamp(this.cameraPitch - mouse.dy * 0.0028, -0.72, 0.5);
      const dist = 6.2;
      const height = 2.9 + this.cameraPitch * 3.2;
      const want = new THREE.Vector3(
        this.player.x - Math.sin(this.cameraYaw) * dist * Math.cos(this.cameraPitch),
        Math.max(1.2, height),
        this.player.z - Math.cos(this.cameraYaw) * dist * Math.cos(this.cameraPitch),
      );
      this.camPos.lerp(want, 1 - Math.exp(-12 * dt));
      this.camLook.lerp(new THREE.Vector3(this.player.x, 1.45, this.player.z), 1 - Math.exp(-14 * dt));
    }
    // keep the camera out of buildings
    const r = this.world.resolveCircle(this.camPos.x, this.camPos.z, 0.9);
    this.camPos.x = r.x;
    this.camPos.z = r.z;

    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * 0.55;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * sh,
      this.camPos.y + (Math.random() - 0.5) * sh,
      this.camPos.z + (Math.random() - 0.5) * sh,
    );
    this.camera.lookAt(this.camLook);
    this.camera.fov = damp(this.camera.fov, car ? 66 + Math.hypot(car.vx, car.vz) * 0.12 : 62, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  // ---------- the loop ----------

  loop(ts) {
    requestAnimationFrame(this.loop);
    if (!this.lastTime) this.lastTime = ts;
    let dt = (ts - this.lastTime) / 1000;
    this.lastTime = ts;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    this.now = ts;
    this.frame++;

    const fixed = 1 / 60;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= fixed && steps < 5) {
      this.tick(fixed);
      this.acc -= fixed;
      steps++;
    }
    this.camera.renderer = this.renderer;
    this.updateCamera(dt);
    this.renderer.toneMappingExposure = this.world.renderExposure || 1.5;
    this.renderer.render(this.scene, this.camera);
    this.hud.tick(ts);
    this.input.endFrame();
  }

  tick(dt) {
    this.ticks++;
    const input = this.input;

    if (this.mode === 'title') {
      this.idleOrbit(dt);
      return;
    }
    if (this.mode === 'paused' || this.mode === 'busted' || this.mode === 'wasted') {
      this.traffic.step(dt, this.player, this.player.car, this.world, null);
      this.world.step(dt);
      return;
    }

    // global one-shots
    if (input.justPressed('pause')) {
      this.pause();
      return;
    }
    if (input.justPressed('mute')) {
      this.audio.toggleMute();
    }
    if (input.justPressed('reload')) this.player.startReload();
    if (input.justPressed('weapon1')) this.player.switchWeapon('pistol');
    if (input.justPressed('weapon2')) this.player.switchWeapon('fists');

    // clock: one in-game day every seven real minutes
    this.clockMinutes = (this.clockMinutes + (dt * 1440) / CLOCK.realSecondsPerDay) % 1440;
    this.world.step(dt, this.clockMinutes);

    const car = this.player.car;
    this.pose = car ? 'driving' : 'foot';

    if (car) {
      // driving
      if (input.justPressed('enter')) this.exitCar();
      else {
        this.cars.stepPlayerCar(dt, input, this.audio);
        if (input.fireClicked) this.hornPress();
      }
      const sp = Math.hypot(car.vx, car.vz);
      if (this.audio) this.audio.setEngine(sp / car.spec.top, Math.abs(car.throttle), true);
    } else {
      // on foot
      this.player.step(dt, input, this.cameraYaw);
      if (this.audio) this.audio.setEngine(0, 0, false);
      if (input.justPressed('enter')) {
        const near = this.cars.nearestCar(this.player.x, this.player.z, PLAYER.enterRange, null, true);
        if (near) this.enterCar(near.car);
      }
      if (input.fireClicked) this.fireWeapon();
      if (input.justPressed('punch')) this.punchAction();
    }

    // pedestrians under the wheels
    if (car) {
      const hits = this.traffic.checkPedHits(car, dt);
      for (const h of hits) this.raiseWanted(1);
      this.cars.resolveCarCollisions(dt);
    }

    // traffic and police
    this.traffic.step(dt, this.player.car ? { x: this.player.car.x, z: this.player.car.z } : this.player, this.player.car, this.world, this.crimeAt);
    this.crimeAt = this.crimeAt && this.crimeAt.t > 0 ? { ...this.crimeAt, t: this.crimeAt.t - dt } : null;
    this.police.step(dt, this.player, this.player.car, this.pose);
    this.cars.coast(dt);
    this.cars.stepParticles(dt);
    this.missions.update(dt);

    // health at zero or a wrecked car
    if (this.player.health <= 0) this.waste('You went down in the street.');

    if (this.audio) this.audio.setMusic(this.police.stars);
    this.updateHud();
    this.updateStatus();
    this.runShotScript();
  }

  hornPress() {
    const car = this.player.car;
    if (!car) return;
    if (car.honkCd <= 0) {
      car.honkCd = 0.6;
      this.audio.horn();
    }
  }

  idleOrbit(dt) {
    // on the title screen the camera drifts over the harbour
    this.cameraYaw += dt * 0.06;
    const r = 120;
    const x = Math.sin(this.cameraYaw) * r + 160;
    const z = Math.cos(this.cameraYaw) * r - 60;
    this.camera.position.lerp(new THREE.Vector3(x, 42, z), 1 - Math.exp(-0.9 * dt));
    this.camera.lookAt(new THREE.Vector3(140, 6, -80));
    this.renderer.toneMappingExposure = this.world.renderExposure || 1.5;
  }

  updateHud() {
    const p = this.player;
    const hud = this.hud;
    hud.setHealth(p.health, p.maxHealth);
    hud.setCash(this.cash);
    hud.setStars(this.police.stars, this.police.stars >= 4 || this.police.arrestT > 0.4);
    hud.setClock(this.clockMinutes);
    hud.setWeapon(p.weapon === 'pistol' ? 'PISTOL' : 'FISTS', p.weapon === 'pistol' ? p.ammoLabel : '— / —');
    if (this.shotObjective) {
      hud.setObjective(this.shotObjective.job, this.shotObjective.name, this.shotObjective.step);
    } else if (!this.missions.complete) {
      hud.setObjective(this.missions.jobLabel, this.missions.jobName, this.missions.objectiveText);
    } else {
      hud.setObjective('ROOKIE TO KINGPIN', 'THE CITY IS YOURS', this.missions.objectiveText);
    }

    const car = p.car;
    if (car) {
      const kmh = Math.hypot(car.vx, car.vz) * 3.6;
      const gear = car.forwardSpeed < -0.6 ? 'R' : Math.hypot(car.vx, car.vz) < 0.4 ? 'P' : 'D';
      hud.setSpeed(kmh, gear, true);
    } else {
      hud.setSpeed(0, 'N', false);
    }

    // context prompt
    let prompt = '';
    if (car) {
      prompt = 'E — get out · Shift — handbrake · H — horn';
    } else {
      const near = this.cars.nearestCar(p.x, p.z, PLAYER.enterRange, null, true);
      if (near) prompt = `E — take the ${near.car.type === 'police' ? 'police cruiser' : CAR_SPECS[near.car.type].label}`;
      else if (p.weapon === 'pistol' && p.mag === 0) prompt = 'R — reload';
    }
    hud.setPrompt(prompt);

    hud.drawMinimap({
      focus: car ? { x: car.x, z: car.z } : { x: p.x, z: p.z },
      player: { x: car ? car.x : p.x, z: car ? car.z : p.z, heading: car ? car.heading : p.heading },
      traffic: this.cars.cars.filter((c) => c.driver === 'ai'),
      police: this.police.units.filter((u) => !u.car.wrecked).map((u) => ({ x: u.car.x, z: u.car.z })),
      marker: this.missions.targetPos(),
      flashRed: Math.floor(this.now / 400) % 2 === 0,
      now: this.now,
    });
  }

  updateStatus() {
    const m = this.missions;
    const text = `${m.objectiveText}. Wanted level ${this.police.stars} of 5. Cash $${this.cash}. Health ${Math.round(this.player.health)}.`;
    this.hud.setStatus(text);
    if (!this.titleReported) {
      this.titleReported = true;
      document.title = 'PORT MERIDIAN — ' + m.jobName;
    }
  }

  // ---------- shot script support ----------

  runShotScript() {
    if (!this.shotScript) return;
    this.shotTicks++;
    if (this.shotTicks >= this.shotTicksTotal) {
      this.shotScript = null;
      window.__shotReady = true;
    }
  }

  runTicks(n, fn) {
    for (let i = 0; i < n; i++) {
      if (fn) fn(i);
      this.tick(1 / 60);
    }
    this.updateCamera(0.016);
    this.updateHud();
  }

  // A deterministic camera for the screenshot staging: no easing, no drift.
  // `track` pulls the camera out along the subject's lateral axis for a side-on frame,
  // which is the only way to get a chasing car and the cars behind it into one shot.
  applyShotCamera(spec) {
    if (spec.pos && spec.target) {
      this.camPos.set(spec.pos.x, spec.pos.y, spec.pos.z);
      this.camLook.set(spec.target.x, spec.target.y, spec.target.z);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.camera.fov = spec.fov ?? 62;
      this.camera.updateProjectionMatrix();
      return;
    }
    const car = this.player.car;
    const baseYaw = spec.yaw !== undefined ? spec.yaw : car ? car.heading : this.player.heading;
    const anchor = spec.anchor || (car ? { x: car.x, z: car.z } : { x: this.player.x, z: this.player.z });
    const back = spec.back ?? 8.4;
    const up = spec.up ?? 3.3;
    const side = spec.side ?? 0;
    const track = spec.track ?? 0;
    const fx = Math.sin(baseYaw);
    const fz = Math.cos(baseYaw);
    const rx = Math.cos(baseYaw);
    const rz = -Math.sin(baseYaw);
    const lookX = anchor.x + fx * (spec.lookAhead ?? 2.0);
    const lookZ = anchor.z + fz * (spec.lookAhead ?? 2.0);
    const cx = anchor.x - fx * back + rx * (side + track);
    const cz = anchor.z - fz * back + rz * (side + track);
    this.camPos.set(cx, up, cz);
    this.camLook.set(lookX, spec.lookY ?? 1.25, lookZ);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.fov = spec.fov ?? 62;
    this.camera.updateProjectionMatrix();
  }

  renderOnce() {
    this.updateCamera(0.016);
    this.renderer.toneMappingExposure = this.world.renderExposure || 1.5;
    this.renderer.render(this.scene, this.camera);
  }
}

function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) throw new Error('no #game canvas on the page');
  const game = new Game(canvas);
  // the playtest drives the real modules through the input override
  window.__playtest = {
    game,
    ticks(n, fn) {
      for (let i = 0; i < n; i++) {
        if (fn) fn(i);
        game.tick(1 / 60);
      }
      game.updateCamera(0.016);
      game.updateHud();
      game.renderOnce();
      return game;
    },
    start() {
      game.startFresh();
      return game;
    },
    hold(name, on) {
      game.input.holdAction(name, on);
    },
    tap(name) {
      game.input.tapAction(name);
    },
    state() {
      const g = game;
      return {
        mode: g.mode,
        cash: g.cash,
        health: g.player.health,
        stars: g.police.stars,
        pose: g.pose,
        objective: g.missions.objectiveText,
        job: g.missions.index,
        step: g.missions.step,
        complete: g.missions.complete,
        car: g.player.car ? g.player.car.type : null,
        px: g.player.x,
        pz: g.player.z,
        units: g.police.units.length,
        peds: g.traffic.peds.length,
        buildings: g.world.buildings.length,
        cars: g.cars.cars.length,
        layout: g.world.layoutHash(),
      };
    },
    hudText() {
      const q = (id) => (document.getElementById(id) || {}).textContent;
      return {
        health: q('health-num'),
        cash: q('cash'),
        clock: q('clock-time'),
        phase: q('clock-phase'),
        weapon: q('weapon-name'),
        ammo: q('weapon-ammo'),
        job: q('obj-job'),
        name: q('obj-name'),
        step: q('obj-step'),
        stars: Array.from(document.querySelectorAll('#stars .star')).filter((s) => s.className.includes('lit') || s.className.includes('hot')).length,
        prompt: q('prompt'),
        gear: q('gear'),
        speed: q('speedo-num'),
      };
    },
  };
  window.__ready = true;
  return game;
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

