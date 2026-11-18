// Port Meridian — the game loop and modes.
// A fixed-step loop clamped to a sane delta driving a requestAnimationFrame. Modes: title,
// play, paused, busted, wasted. The page exposes the game on window as __game and a
// __shotReady flag for the screenshot tooling.

import * as THREE from 'three';
import {
  CITY, CLOCK, PLAYER, HEAT, SAVE_KEY, WEAPONS, MISSION_DEFS, PLACES, RENDER,
} from './config.js';
import { Rng, clamp, damp } from './random.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { City } from './world.js';
import { VehicleManager } from './vehicles.js';
import { Player } from './player.js';
import { Traffic, TrafficManager } from './traffic.js';
import { Police } from './police.js';
import { Missions, Beacon, makeCase } from './missions.js';
import { Hud } from './hud.js';
import { runShot, isStagedShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const MAX_FRAME = 0.1;

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(RENDER.fov, aspect, 0.1, 1400);
    this.camera.position.set(0, 12, 24);
    this.yaw = -Math.PI / 2;
    this.pitch = 0.22;
    this.distance = 25;
    this.height = 9;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.shake = 0;
    this.mode = 'staged';
    this.stageYaw = 0;
    this.stagePitch = 0.2;
    this.stageDistance = 12;
    this.stageHeight = 3;
    this.stageTargetHeight = 1.2;
    this.fovBoost = 0;
  }

  follow(car) {
    this.mode = 'car';
  }

  followOnFoot(player) {
    this.mode = 'foot';
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, game) {
    const car = game.playerCar;
    const player = game.player;
    let targetX;
    let targetY;
    let targetZ;
    let wantYaw = this.yaw;
    let wantPitch = this.pitch;
    let dist = this.distance;
    let height = this.height;

    if (this.mode === 'titleOrbit' || (game.mode === 'title' && this.mode !== 'staged')) {
      const t = game.time * 0.055;
      const r = 138;
      this.camera.position.set(
        70 + Math.cos(t) * r,
        46 + Math.sin(t * 1.6) * 7,
        -110 + Math.sin(t) * r,
      );
      this.smoothTarget.set(60, 2, -105);
      this.camera.lookAt(60, 2, -105);
      return;
    }

    if (this.mode === 'staged') {
      const focusX = game.stagedFocus ? game.stagedFocus.x : 0;
      const focusZ = game.stagedFocus ? game.stagedFocus.z : 0;
      const yaw = this.stageYaw;
      this.camera.position.set(
        focusX + Math.cos(yaw) * this.stageDistance,
        this.stageHeight,
        focusZ + Math.sin(yaw) * this.stageDistance,
      );
      this.camera.lookAt(focusX, this.stageTargetHeight, focusZ);
      return;
    }

    if (car) {
      // Behind the car, tucked low with a little lag, easing back slightly with speed.
      const speed01 = Math.min(1, Math.abs(car.forwardSpeed) / car.spec.topSpeed);
      dist = 9.6 + speed01 * 3.4;
      height = 3.1 + speed01 * 0.7;
      // The rig's yaw uses the same convention as car.angle (forward is (-sin, -cos)), so the
      // camera sits behind the car looking the way it points.
      wantYaw = car.angle;
      wantPitch = 0.16 + speed01 * 0.05;
      targetX = car.x;
      targetY = 1.5;
      targetZ = car.z;
      this.yaw = dampAngle(this.yaw, wantYaw, 3.6, dt);
      this.pitch = damp(this.pitch, wantPitch, 3, dt);
    } else {
      // Behind the character on foot, orbiting with the mouse.
      targetX = player.x;
      targetY = 1.5;
      targetZ = player.z;
      dist = 4.6;
      height = 2.3;
      this.yaw = dampAngle(this.yaw, wantYaw, 12, dt);
    }

    this.smoothTarget.x = damp(this.smoothTarget.x, targetX, 9, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, targetY, 9, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, targetZ, 9, dt);

    const cx = this.smoothTarget.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist;
    const cy = this.smoothTarget.y + Math.sin(this.pitch) * dist + height * 0.42;
    const cz = this.smoothTarget.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist;

    this.camera.position.x = damp(this.camera.position.x, cx, 10, dt);
    this.camera.position.y = damp(this.camera.position.y, cy, 8, dt);
    this.camera.position.z = damp(this.camera.position.z, cz, 10, dt);

    const shake = this.shake;
    if (shake > 0.001) {
      const t = game.time * 47;
      this.camera.position.x += Math.sin(t) * shake * 0.5;
      this.camera.position.y += Math.cos(t * 1.7) * shake * 0.35;
      this.shake = Math.max(0, shake - dt * 2.6);
    }

    this.camera.lookAt(this.smoothTarget.x, this.smoothTarget.y + 0.4, this.smoothTarget.z);
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.0032;
    this.pitch = clamp(this.pitch + dy * 0.0028, -0.32, 1.1);
  }
}

function dampAngle(a, b, lambda, dt) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * (1 - Math.exp(-lambda * dt));
}

// ---------------------------------------------------------------------------
// Overlay controller
// ---------------------------------------------------------------------------

class Overlays {
  constructor() {
    this.mode = 'title';
    this.els = {
      title: document.getElementById('overlay'),
      pause: document.getElementById('pause-overlay'),
      busted: document.getElementById('busted-overlay'),
      wasted: document.getElementById('wasted-overlay'),
    };
    this.saveRow = document.getElementById('save-row');
    this.continueBtn = document.getElementById('btn-continue');
  }

  show(mode) {
    this.mode = mode;
    for (const [key, el] of Object.entries(this.els)) {
      el.classList.toggle('show', key === mode);
    }
  }

  hideAll() {
    for (const el of Object.values(this.els)) el.classList.remove('show');
    this.mode = null;
  }
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

export class Game {
  constructor(options = {}) {
    this.seed = options.seed ?? CITY.defaultSeed;
    this.shot = options.shot ?? null;
    this.canvas = document.getElementById('world');
    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new CameraRig(window.innerWidth / window.innerHeight);
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine();
    this.input.onFirstGesture(() => this.audio.start());

    this.time = 0;
    this.clockMinutes = CLOCK.startMinutes;
    this.mode = 'title';
    this.cash = 250;
    this.damageFlash = 0;
    this.prompt = '';
    this.hitFlash = 0;
    this.lastSaveInfo = null;
    this.pausedFrames = 0;
    this.stagedScript = null;
    this.stagedTicksLeft = 0;
    this.stagedFocus = null;
    this.brakeHooks = [];
    this.crimeCooldown = 0;
    this.missionAdvanceTimer = 0;
    this.storyComplete = false;
    this.fovBoost = 0;
    this.stagedBeacon = null;

    this.rng = new Rng(`game:${this.seed}`);
    this.city = new City(this.scene, this.seed);
    this.vehicles = new VehicleManager(this.scene, this.city, this.audio);
    this.player = new Player(this.scene);
    this.traffic = new Traffic(this.scene, this.city, this.seed);
    this.police = new Police(this.scene, this.city, this.vehicles, this.audio, this.seed);
    this.police.onBusted = () => this.enterBusted();
    this.missions = new Missions(this.scene, this.city, this.vehicles, this.audio);
    this.missions.onComplete = (job) => this.onMissionComplete(job);
    this.hud = new Hud();
    this.overlays = new Overlays();

    this.trafficManager = new TrafficManager(this.scene, this.city, this.vehicles, this.seed);
    this.playerCar = null;

    this.vehicles.onCrash = (car, impact, destroyed) => this.onCrash(car, impact, destroyed);
    this.police.mgrOnRam = (car) => this.onPoliceRam(car);

    this._bindUi();
    this._bindWindow();

    // Seed the street with parked cars.
    this._spawnParkedCars();

    this.refreshSaveUi();
    this.handleLaunchMode();
  }

  // --- setup -------------------------------------------------------------

  _spawnParkedCars() {
    const rng = new Rng(`parked:${this.seed}`);
    const kinds = ['sedan', 'sedan', 'taxi', 'sports', 'truck'];
    let placed = 0;
    for (let attempt = 0; attempt < 90 && placed < 22; attempt++) {
      const spot = this.city.findParkingSpot(
        rng.range(-CITY.bound * 0.8, CITY.seaEdge - 40),
        rng.range(-CITY.bound * 0.8, CITY.bound * 0.8),
        this.vehicles.cars,
        40,
      );
      if (!spot) continue;
      this.vehicles.spawn(rng.pick(kinds), spot.x, spot.z, spot.angle, 'parked');
      placed++;
    }
    // One guaranteed car near the player's start so job one is never a long walk.
    const start = PLACES.start;
    const near = this.city.findParkingSpot(start.x, start.z, this.vehicles.cars, 0)
      ?? this.city.findClearSpot(start.x + 10, start.z + 12, 30);
    this.vehicles.spawn('sedan', near.x, near.z, near.angle ?? Math.PI / 2, 'parked');
  }

  _bindUi() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('btn-start', () => this.startNew());
    on('btn-continue', () => this.continueSave());
    on('btn-resume', () => this.resume());
    on('btn-save', () => this.saveGame(true));
    on('btn-restart', () => this.startNew());
    on('btn-walkout', () => this.respawn());
    on('btn-getup', () => this.respawn());
  }

  _bindWindow() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera.resize(w / h);
    });
  }

  handleLaunchMode() {
    if (this.shot && isStagedShot(this.shot)) {
      this.mode = 'play';
      this.overlays.hideAll();
      runShot(this, this.shot);
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.loop(t));
      return;
    }
    this.mode = 'title';
    this.overlays.show('title');
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  // --- modes -------------------------------------------------------------

  startNew() {
    this.resetWorld();
    this.cash = 250;
    this.clockMinutes = CLOCK.startMinutes;
    this.player.health = PLAYER.health;
    this.player.reset(PLACES.start.x, PLACES.start.z);
    this.police.clear();
    this.missions.reset();
    this.missions.start(0, 0);
    this.mode = 'play';
    this.overlays.hideAll();
    this.playerCar = null;
    this.camera.mode = 'foot';
    this.camera.yaw = Math.PI;
    this.time = 0;
    this.storyComplete = false;
    this.missionAdvanceTimer = 1.2;
    this.renderer.toneMappingExposure = RENDER.exposure;
    this.city.setNightLift(0);
    this.fovBoost = 0;
    this.applyCameraFov();
    this.audio.start();
    this.hud.update(this, 0.016);
  }

  resetWorld() {
    this.vehicles.clearAll();
    this.trafficManager.clear();
    this.playerCar = null;
    this.police.clear();
    this.police.clearStaticOfficers();
    this.trafficManager = new TrafficManager(this.scene, this.city, this.vehicles, this.seed);
    this.traffic.reset();
    this._spawnParkedCars();
  }

  continueSave() {
    const save = this.loadSave();
    if (!save) return;
    this.startNew();
    this.cash = save.cash ?? 250;
    this.clockMinutes = save.clockMinutes ?? CLOCK.startMinutes;
    this.police.stars = clamp(save.stars ?? 0, 0, 5);
    this.player.showAt(save.x ?? PLACES.start.x, save.z ?? PLACES.start.z, save.heading ?? Math.PI);
    this.player.health = save.health ?? PLAYER.health;
    this.player.magazine = save.magazine ?? WEAPONS.pistol.magazine;
    this.player.reserve = save.reserve ?? WEAPONS.pistol.reserve;
    if (typeof save.mission === 'number' && save.mission >= 0) {
      this.missions.start(save.mission, save.step ?? 0);
    }
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.overlays.show('pause');
    this.saveGame(false);
    this.input.releaseAll();
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'play';
    this.overlays.hideAll();
    this.renderer.toneMappingExposure = RENDER.exposure;
  }

  enterBusted() {
    if (this.mode !== 'play') return;
    this.mode = 'busted';
    this.cash = Math.max(0, this.cash - 150);
    this.police.clear();
    this.audio.busted();
    this.input.releaseAll();
    this.overlays.show('busted');
  }

  enterWasted() {
    if (this.mode === 'wasted') return;
    this.mode = 'wasted';
    this.police.clear();
    this.audio.busted();
    this.input.releaseAll();
    this.overlays.show('wasted');
  }

  respawn() {
    this.exitCar(true);
    this.player.reset(PLACES.respawn.x, PLACES.respawn.z);
    this.player.health = PLAYER.health;
    this.player.magazine = WEAPONS.pistol.magazine;
    this.player.reserve = WEAPONS.pistol.reserve;
    this.player.showAt(PLACES.respawn.x, PLACES.respawn.z, Math.PI);
    this.police.clear();
    this.camera.mode = 'foot';
    this.camera.yaw = Math.PI;
    this.mode = 'play';
    this.overlays.hideAll();
    this.damageFlash = 0;
  }

  // --- saving ------------------------------------------------------------

  saveGame(showPulse) {
    const p = this.player;
    const data = {
      v: 1,
      cash: this.cash,
      mission: this.missions.index,
      step: this.missions.step,
      x: p.x,
      z: p.z,
      heading: p.angle,
      clockMinutes: this.clockMinutes,
      stars: this.police.stars,
      health: p.health,
      magazine: p.magazine,
      reserve: p.reserve,
      at: Date.now(),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.lastSaveInfo = data;
      this.refreshSaveUi();
      return true;
    } catch {
      // Private mode: storage throws. Tolerate it and keep playing.
      this.lastSaveInfo = data;
      return false;
    }
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return null;
      return data;
    } catch {
      return null;
    }
  }

  refreshSaveUi() {
    const save = this.loadSave();
    const row = this.overlays.saveRow;
    const btn = this.overlays.continueBtn;
    if (save) {
      const when = new Date(save.at ?? Date.now());
      const hh = String(when.getHours()).padStart(2, '0');
      const mm = String(when.getMinutes()).padStart(2, '0');
      const job = MISSION_DEFS[clamp(save.mission ?? 0, 0, MISSION_DEFS.length - 1)];
      if (row) row.innerHTML = `BEST SAVE — <b>${job ? job.name : 'Port Meridian'}</b> · $${Number(save.cash ?? 0).toLocaleString('en-US')} · saved ${hh}:${mm}`;
      if (btn) btn.disabled = false;
    } else {
      if (row) row.textContent = 'No save yet — START begins at the docks with $250.';
      if (btn) btn.disabled = true;
    }
  }

  // --- staging helpers used by shots.js ----------------------------------

  setPlayerCar(car) {
    this.playerCar = car;
    car.owned = 'player';
    this.camera.follow(car);
  }
  exitCar(force = false) {
    if (!this.playerCar) return;
    const car = this.playerCar;
    const side = {
      x: car.x + Math.cos(car.angle) * 2.6,
      z: car.z - Math.sin(car.angle) * 2.6,
    };
    this.playerCar = null;
    car.owned = 'parked';
    if (!force) this.player.showAt(side.x, side.z, car.angle);
    this.camera.mode = 'foot';
  }

  setBrakeHook(car, on) {
    this.brakeHooks = this.brakeHooks.filter((h) => h.car !== car);
    if (on) this.brakeHooks.push({ car });
  }

  stageBeacon(x, z) {
    const beacon = new Beacon(this.scene, x, z);
    this.stagedBeacon = beacon;
    return beacon;
  }

  // The green case the marina job uses, without running the job's check logic.
  stageCase(x, z) {
    this.stagedCase = makeCase(this.city);
    this.stagedCase.position.set(x, 0, z);
    this.scene.add(this.stagedCase);
    return this.stagedCase;
  }

  stagePeds(spots, opts = {}) {
    const peds = this.traffic.peds;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (i < spots.length) {
        p.x = spots[i][0];
        p.z = spots[i][1];
        p.angle = (opts.facing ?? 1) > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
        p.fear = opts.flee ? 5 : 0;
        p.down = false;
        p.y = 0;
        p.body.rotation.x = 0;
        p.mesh.visible = true;
        p.mesh.position.set(p.x, 0, p.z);
        p.mesh.rotation.y = p.angle;
      } else {
        p.mesh.visible = false;
        p.x = 4000;
        p.z = 4000;
      }
    }
    if (opts.flee) this.traffic.scatter(spots[0][0], spots[0][1], 4);
  }

  smokeSeed() {
    for (const car of this.vehicles.cars) {
      if (car.owned !== 'player') continue;
      for (let i = 0; i < 6; i++) {
        this.vehicles.particles.puff(car.x + (Math.random() - 0.5) * 2.4, 1 + Math.random(), car.z + (Math.random() - 0.5) * 2.4, 1);
      }
    }
  }

  smokeTick(car, dt) {
    this.vehicles.particles.update(dt);
    if (Math.random() < 0.7) {
      this.vehicles.particles.puff(
        car.x + Math.sin(car.angle) * car.spec.length * 0.35 + (Math.random() - 0.5),
        1.1,
        car.z + Math.cos(car.angle) * car.spec.length * 0.35 + (Math.random() - 0.5),
        0.9,
      );
    }
  }

  skidBurst(car, count) {
    const sin = Math.sin(car.angle);
    const cos = Math.cos(car.angle);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const x = car.x - car.vx * t * 0.06 + Math.cos(car.angle) * (i % 2 ? 1 : -1) * car.spec.width * 0.42;
      const z = car.z - car.vz * t * 0.06 - Math.sin(car.angle) * (i % 2 ? 1 : -1) * car.spec.width * 0.42;
      this.vehicles.particles.mark(x, z, car.angle);
    }
  }

  applyCameraFov() {
    const fov = RENDER.fov + this.fovBoost;
    this.camera.camera.fov = fov;
    this.camera.camera.updateProjectionMatrix();
  }

  // --- crimes ------------------------------------------------------------

  raiseHeat(stars) {
    if (this.crimeCooldown > 0) return;
    if (this.police.raise(stars)) {
      this.crimeCooldown = 0.35;
    }
  }

  onCrash(car, impact, destroyed) {
    if (car === this.playerCar) {
      this.damageFlash = Math.min(1, 0.25 + impact / 26);
      this.camera.shake = Math.max(this.camera.shake, Math.min(1, impact / 18));
    }
    if (destroyed && car === this.playerCar) {
      this.exitCar(true);
      this.player.health = 0;
      this.enterWasted();
    }
  }

  onPoliceRam(car) {
    this.damageFlash = Math.min(1, this.damageFlash + 0.25);
    this.camera.shake = Math.max(this.camera.shake, 0.5);
  }

  onMissionComplete(job) {
    this.cash += job.reward;
    this.police.cool(1);
    this.missionAdvanceTimer = 1.2;
  }

  // Shooting: raycast toward the nearest pedestrian and police cars in front of the player,
  // with a generous aim cone.
  fire() {
    const p = this.player;
    if (this.player.weapon !== 'pistol') return;
    if (p.reloading > 0 || p.fireCooldown > 0) return;
    if (p.magazine <= 0) {
      p.reload();
      return;
    }
    p.spendRound();
    this.audio.gunshot();
    this.camera.shake = Math.max(this.camera.shake, 0.16);

    const forward = new THREE.Vector3(-Math.sin(p.angle), 0, -Math.cos(p.angle));
    let best = null;
    let bestScore = 0;

    // Pedestrians.
    for (const ped of this.traffic.peds) {
      if (ped.down) continue;
      const dx = ped.x - p.x;
      const dz = ped.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > WEAPONS.pistol.range) continue;
      const dot = (dx * forward.x + dz * forward.z) / (d || 1);
      if (dot < 0.86) continue;              // generous ~30 degree cone
      const score = dot * 100 - d * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = { ped, d, y: 1.1 };
      }
    }
    // Police cars.
    for (const car of this.vehicles.cars) {
      if (car.owned !== 'police' && car.owned !== 'parked' && car.owned !== 'traffic') continue;
      const dx = car.x - p.x;
      const dz = car.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > WEAPONS.pistol.range) continue;
      const dot = (dx * forward.x + dz * forward.z) / (d || 1);
      if (dot < 0.9) continue;
      const score = dot * 96 - d * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = { car, d, y: 1.0 };
      }
    }

    p.flashMuzzle(best ? { x: best.ped ? best.ped.x : best.car.x, y: best.y, z: best.ped ? best.ped.z : best.car.z } : null);

    if (best && best.ped) {
      best.ped.hit(1);
      this.traffic.scatter(best.ped.x, best.ped.z, 1);
      this.raiseHeat(2);
      this.traffic.checkCarHitsSafe = true;
    } else if (best && best.car) {
      const destroyed = best.car.applyDamage(WEAPONS.pistol.damage);
      this.vehicles.particles.puff(best.car.x, 1.1, best.car.z, 0.6);
      if (best.car.owned === 'police') {
        this.raiseHeat(2);
        if (destroyed) this.raiseHeat(1);
      }
    }
  }

  punch() {
    const p = this.player;
    if (!p.punch()) return;
    this.audio.punch();
    const forward = new THREE.Vector3(-Math.sin(p.angle), 0, -Math.cos(p.angle));
    const near = this.traffic.nearestPedestrian(p.x, p.z, 2.9);
    if (near) {
      const dx = near.ped.x - p.x;
      const dz = near.ped.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = (dx * forward.x + dz * forward.z) / d;
      if (dot > 0.35) {
        near.ped.hit(0.6);
        this.audio.punch();
        this.traffic.scatter(near.ped.x, near.ped.z, 0.8);
        this.raiseHeat(2);
      }
    }
    // Punching an officer counts as assaulting an officer.
    for (const unit of this.police.units) {
      for (const off of unit.officers) {
        if (Math.hypot(off.x - p.x, off.z - p.z) < 2.6) this.raiseHeat(1);
      }
    }
  }

  // --- the car enter / exit flow ----------------------------------------

  tryEnterCar() {
    if (this.playerCar) return;
    const p = this.player;
    const found = this.vehicles.nearest(p.x, p.z, (c) => !c.wrecked && c.owned !== 'police', PLAYER.enterRange);
    const policeFound = this.vehicles.nearest(p.x, p.z, (c) => !c.wrecked && c.owned === 'police', PLAYER.enterRange);
    const pick = found ?? policeFound;
    if (!pick) return;
    const car = pick.car;
    if (!found && policeFound) this.raiseHeat(2);       // a police car costs more heat
    else this.raiseHeat(1);                             // stealing a car is one star
    this.playerCar = car;
    car.owned = 'player';
    car.driver = 'player';
    this.player.followCar(car);
    this.camera.follow(car);
    this.missions.onEnterCar?.(car);
  }

  tryExitCar() {
    if (!this.playerCar) return;
    const car = this.playerCar;
    if (Math.abs(car.forwardSpeed) > 6) return;         // do not step out at speed
    const sideX = car.x + Math.cos(car.angle) * 2.7;
    const sideZ = car.z - Math.sin(car.angle) * 2.7;
    const resolved = { x: sideX, z: sideZ };
    this.city.resolveCircle(resolved, PLAYER.radius, { x: car.x, z: car.z });
    car.owned = 'parked';
    car.driver = null;
    this.playerCar = null;
    this.player.showAt(resolved.x, resolved.z, car.angle + Math.PI / 2);
    this.camera.mode = 'foot';
    this.camera.yaw = car.angle + Math.PI;
  }

  // --- the loop ----------------------------------------------------------

  loop(now) {
    if (!this.running) return;
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = clamp(raw || 0, 0, MAX_FRAME);
    this.frame(dt);
    requestAnimationFrame((t) => this.loop(t));
  }

  frame(dt) {
    const sub = this.mode === 'play' ? dt : Math.min(dt, FIXED_STEP);
    this.time += sub;
    this.updateClock(sub);
    this.updateInputForMode(sub);
    // A staged screenshot is a still frame: nothing steps once it is posed.
    if (this.shot && isStagedShot(this.shot)) {
      this.hud.update(this, sub);
      this.renderer.render(this.scene, this.camera.camera);
      this.input.endFrame();
      return;
    }
    if (this.mode === 'play') this.stepPlay(sub);
    else if (this.mode === 'title') this.stepTitle(sub);
    else this.stepIdle(sub);

    this.camera.update(sub, this);
    this.hud.update(this, sub);
    this.renderer.render(this.scene, this.camera.camera);

    // Damage vignette decays over time.
    this.damageFlash = Math.max(0, this.damageFlash - sub * 1.6);
    this.crimeCooldown = Math.max(0, this.crimeCooldown - sub);

    this.input.endFrame();
  }

  updateClock(dt) {
    const rate = 1440 / CLOCK.dayRealSeconds;     // in-game minutes per real second
    this.clockMinutes = (this.clockMinutes + rate * dt) % 1440;
    if (this.mode === 'play' && !this.shot) {
      this.city.setClockT(this.clockMinutes / 1440);
    }
  }
  updateInputForMode(dt) {
    const input = this.input;
    const { dx, dy } = input.consumeMouse();
    if ((this.mode === 'play' || this.mode === 'paused') && this.camera.mode !== 'staged') {
      if (dx || dy) this.camera.orbit(dx, dy);
    }
    if (this.mode === 'title') {
      if (input.pressed('Enter') || input.pressed('Space')) this.startNew();
      return;
    }
    if (this.mode === 'paused') {
      if (input.pressed('KeyP') || input.pressed('Escape')) this.resume();
      return;
    }
    if (this.mode === 'busted' || this.mode === 'wasted') {
      if (input.pressed('Enter') || input.pressed('Space')) this.respawn();
      return;
    }
    if (this.mode !== 'play') return;

    if (input.pressed('KeyP') || input.pressed('Escape')) { this.pause(); return; }
    if (input.pressed('KeyM')) this.audio.toggleMute();
    if (input.pressed('Digit1')) this.player.setWeapon('pistol');
    if (input.pressed('Digit2')) this.player.setWeapon('fists');
    if (input.pressed('KeyE')) {
      if (this.playerCar) this.tryExitCar();
      else this.tryEnterCar();
    }
    if (this.playerCar && input.pressed('KeyH')) this.audio.horn();
    if (input.pressed('KeyR')) this.player.reload();
    if (input.pressed('KeyF')) this.punch();
    if ((input.fireHeld() || input.firePressed()) && !this.playerCar) {
      if (this.player.weapon === 'pistol') this.fire();
      else if (input.firePressed()) this.punch();
    }
  }

  stepPlay(dt) {
    const input = this.input;
    const p = this.player;

    // After a job completes, start the next one about 1.2 seconds later.
    if (this.missions.completed && !this.storyComplete && this.missions.bannerTimer <= 0.6) {
      this.missionAdvanceTimer -= dt;
      if (this.missionAdvanceTimer <= 0) {
        if (!this.missions.advanceAfterDelay()) {
          this.storyComplete = true;
        }
        this.missionAdvanceTimer = 1.2;
      }
    }

    if (this.playerCar) {
      const car = this.playerCar;
      const throttle = (input.held('KeyW') || input.held('ArrowUp')) ? 1 : (input.held('KeyS') || input.held('ArrowDown')) ? -1 : 0;
      const steer = (input.held('KeyA') || input.held('ArrowLeft')) ? 1 : (input.held('KeyD') || input.held('ArrowRight')) ? -1 : 0;
      const handbrake = input.held('ShiftLeft') || input.held('ShiftRight') ? 1 : 0;
      const carInput = { throttle, brake: 0, steer, handbrake };
      this.vehicles.drivePlayer(car, carInput, dt);

      // Engine and siren audio tracks the car.
      const speed01 = Math.min(1, Math.abs(car.forwardSpeed) / car.spec.topSpeed);
      this.audio.updateEngine(speed01, throttle > 0 ? 1 : 0, true);

      // Traffic and pedestrians react.
      this.trafficManager.update(dt, car);
      const hits = this.traffic.checkCarHits(car);
      if (hits > 0) this.raiseHeat(1);              // vehicular manslaughter
      this.prompt = 'E — get out · Shift — handbrake · H — horn';

      // A wrecked player car ejects the player and wastes them.
      if (car.wrecked) {
        this.exitCar(true);
        p.health = 0;
        this.enterWasted();
        return;
      }
    } else {
      p.update(dt, input, this.city, this.camera.yaw);
      this.audio.updateEngine(0, 0, false);
      this.trafficManager.update(dt, null);
      // Prompt: nearest car in range.
      const near = this.vehicles.nearest(p.x, p.z, (c) => !c.wrecked, PLAYER.enterRange);
      this.prompt = near ? 'E — take the car' : '';
    }

    this.traffic.update(dt, p, this.playerCar, this.police);
    this.vehicles.particles.update(dt);
    this.vehicles.carCarCollisions();
    this.city.onFrame(dt);
    this.audio.updateMusic(this.police.stars, this.time, false);

    // Police and missions.
    this.police.update(dt, p, this.playerCar, this.mode);

    const ctx = {
      player: p,
      car: this.playerCar,
      inCar: this.playerCar !== null,
      stars: this.police.stars,
      targetCar: this.missions.targetCar,
      carrying: this.missions.carrying,
      cash: this.cash,
    };
    this.missions.update(dt, ctx);

    // Health at zero wastes the player.
    if (p.health <= 0 && this.mode === 'play') this.enterWasted();

    // Brake hooks (the on-foot screenshot keeps a car's brake lights on).
    for (const h of this.brakeHooks) h.car.updateLights(dt, true);
  }

  stepTitle(dt) {
    // The title screen keeps the city alive: traffic moves, the camera drifts.
    this.trafficManager.update(dt, null);
    this.traffic.update(dt, this.player, null, this.police);
    this.city.onFrame(dt);
    this.audio.updateMusic(0, this.time, true);
    this.audio.updateEngine(0, 0, false);
  }

  stepIdle(dt) {
    // Paused, busted and wasted keep the world ticking gently behind the overlay.
    this.police.update(dt, this.player, this.playerCar, this.mode);
    this.vehicles.particles.update(dt);
    this.city.onFrame(dt);
    this.audio.updateMusic(this.police.stars, this.time, true);
    this.audio.updateEngine(0, 0, false);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  const params = new URLSearchParams(location.search);
  const seedRaw = params.get('seed');
  const seed = seedRaw !== null && seedRaw !== '' ? (Number.isFinite(Number(seedRaw)) ? Number(seedRaw) : seedRaw) : CITY.defaultSeed;
  const shot = params.get('shot');
  const loading = document.getElementById('loading');
  try {
    // Flags first: the constructor may stage a screenshot and set __shotReady itself.
    window.__shotReady = false;
    const game = new Game({ seed, shot });
    window.__game = game;
    if (loading) loading.classList.add('hide');
  } catch (err) {
    console.error('Port Meridian failed to start:', err);
    if (loading) loading.textContent = 'FAILED TO START — ' + (err && err.message ? err.message : err);
  }
}

boot();
