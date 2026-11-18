// PORT MERIDIAN — the fixed-timestep loop, the camera, the modes (title, play, paused,
// busted, wasted), save/load, combat and the crime feed that drives the wanted level.
import * as THREE from 'three';
import { CITY, PLAYER, WEAPON, CAR_TYPES, PALETTE } from './config.js';
import { Rng, seedFromQuery } from './random.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { World, parkingSpot } from './world.js';
import { Player } from './player.js';
import { VehicleManager } from './vehicles.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Missions, MISSIONS } from './missions.js';
import { Hud } from './hud.js';
import { applyShot } from './shots.js';

const SAVE_KEY = 'portmeridian.save.v1';
const MODES = ['title', 'play', 'paused', 'busted', 'wasted'];

export class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.ui = document.getElementById('ui');
    this.seed = seedFromQuery(7);
    this.rng = new Rng(this.seed);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1200);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.cameraYaw = 0;
    this.cameraPitch = 0.28;
    this.cameraPos = new THREE.Vector3(0, 5, 10);
    this.camTarget = new THREE.Vector3();

    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.world = new World(this.scene, this.seed);
    this.player = new Player(this.scene);
    this.vehicles = new VehicleManager(this.scene, this.world, this.audio);
    this.vehicles.attachRng(this.rng);
    this.police = new Police(this.scene, this.world, this.vehicles, this.audio, this.rng);
    this.traffic = new Traffic(this.scene, this.world, this.vehicles, this.rng);
    this.missions = new Missions(this.scene, this.world, this.vehicles, this.police, this.audio, this.traffic);
    this.missions.onReward = (amount) => {
      this.cash += amount;
      this.saveGame(false);
    };
    this.hud = new Hud(this.ui);

    this.cash = PLAYER.startCash;
    this.clockMinutes = 19 * 60 + 40;
    this.mode = 'title';
    this.prompt = null;
    this.damageFlash = 0;
    this.crimes = [];
    this.muzzle = null;
    this.tracers = [];
    this.hitmarkTimer = 0;
    this.save = this.loadSave();
    this.spawnCity();
    this.buildMuzzle();
    this.bindOverlays();
    this.ui.classList.remove('hidden');
    this.applyShotPreset();
    if (!this.shot) this.titleScreen();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.step = this.step.bind(this);
    requestAnimationFrame(this.step);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'play') this.pause();
    });
  }

  // --- setup ------------------------------------------------------------
  spawnCity() {
    const rng = this.rng;
    const spawn = { x: 96, z: 96 };
    // Player starts on a pavement on the south-east side of the grid.
    let start = { x: gridSpot(5, 5, 8), z: gridSpot(5, 5, 8) };
    for (let i = 0; i < 30; i++) {
      const x = (rng.int(2, 9) - 6) * CITY.pitch + CITY.pitch / 2;
      const z = (rng.int(2, 9) - 6) * CITY.pitch + CITY.pitch / 2;
      if (!this.world.blocked(x, z, 2)) {
        start = { x, z };
        break;
      }
    }
    this.player.reset(start.x, start.z, 0);

    // Parked cars: one on most corners so a car is always within sight.
    const types = ['sedan', 'sedan', 'taxi', 'sports', 'truck', 'sedan', 'taxi', 'sports'];
    for (let i = 0; i < 16; i++) {
      const spot = parkingSpot(rng, this.world);
      const type = types[i % types.length];
      const colour = type === 'taxi' ? 0xe0b62c : rng.pick(PALETTE.carColors);
      this.vehicles.spawn(type, colour, spot.x, spot.z, spot.heading, 'parked');
    }
    // A guaranteed hero car close to the start, for the first screenshot and mission one.
    const heroSpot = parkingSpot(rng, this.world);
    const hero = this.vehicles.spawn('sports', 0xc8323f, heroSpot.x, heroSpot.z, heroSpot.heading, 'parked');
    hero.pos.set(start.x + 6, 0, start.z);
    hero.mesh.position.copy(hero.pos);
    hero.heading = 0;
  }

  buildMuzzle() {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0 }),
    );
    flash.visible = false;
    this.scene.add(flash);
    this.muzzle = flash;
    const light = new THREE.PointLight(0xffd080, 0, 8, 2);
    this.scene.add(light);
    this.muzzleLight = light;
  }

  bindOverlays() {
    this.overlay = document.getElementById('overlay');
    this.overlay.addEventListener('click', (e) => {
      const action = e.target?.dataset?.action;
      if (!action) return;
      if (action === 'start') this.startGame(false);
      if (action === 'continue') this.startGame(true);
      if (action === 'resume') this.resume();
      if (action === 'restart') this.restart();
      if (action === 'save') this.saveGame(true);
      if (action === 'respawn') this.respawn();
    });
  }

  // --- modes ------------------------------------------------------------
  showOverlay(html, cls = '') {
    this.overlay.className = `show ${cls}`;
    this.overlay.innerHTML = html;
  }

  hideOverlay() {
    this.overlay.className = '';
    this.overlay.innerHTML = '';
  }

  titleScreen() {
    const best = this.save ? `Best save: $${(this.save.cash ?? 0).toLocaleString('en-US')} · job ${(this.save.mission ?? 0) + 1}` : 'No save yet';
    this.showOverlay(`
      <div class="panel title">
        <div class="kicker">A MAKE.FUN ORIGINAL · DUSK HARBOUR</div>
        <h1>PORT <em>MERIDIAN</em></h1>
        <p class="story">The docks took your brother's boat, his name and nearly you. The Meridian Port
        Authority runs this city on bribes and bad coffee; the crews run it on nerve. You have a
        borrowed jacket, a pistol with one magazine and a coastline full of people who owe somebody.
        Start with a car that isn't yours.</p>
        <div class="controls">
          <span><b>WASD</b> move / drive</span><span><b>Shift</b> sprint · handbrake</span>
          <span><b>Space</b> jump</span><span><b>Mouse</b> look · aim</span>
          <span><b>E</b> enter / exit car</span><span><b>Click</b> fire · <b>R</b> reload</span>
          <span><b>F</b> punch</span><span><b>P</b> pause · save</span><span><b>M</b> mute</span>
        </div>
        <div class="best">${best}</div>
        <div class="buttons">
          <button data-action="start">START</button>
          ${this.save ? '<button class="ghost" data-action="continue">CONTINUE</button>' : ''}
        </div>
        <div class="footer">Four jobs. One city. Rookie to kingpin.</div>
      </div>`, 'title');
  }

  startGame(useSave) {
    this.audio.armOnGesture();
    this.mode = 'play';
    this.hideOverlay();
    if (useSave && this.save) this.loadGame();
    else {
      this.cash = PLAYER.startCash;
      this.player.health = PLAYER.maxHealth;
      this.police.setStars(0);
      this.missions.start(0);
    }
    this.lockPointer();
  }

  // Pointer lock needs a user gesture and returns a promise in current Chrome: swallow the
  // rejection and keep the drag-to-look fallback working.
  lockPointer() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* drag fallback */ }
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.saveGame(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.showOverlay(`
      <div class="panel">
        <h2>PAUSED</h2>
        <p class="story">Port Meridian keeps running without you. Autosaved.</p>
        <div class="buttons">
          <button data-action="resume">RESUME</button>
          <button class="ghost" data-action="save">SAVE</button>
          <button class="ghost" data-action="restart">RESTART</button>
        </div>
      </div>`, 'pause');
  }

  resume() {
    this.mode = 'play';
    this.hideOverlay();
    if (this.audio.ctx?.state === 'suspended') this.audio.ctx.resume();
    this.lockPointer();
  }

  restart() {
    window.localStorage.removeItem(SAVE_KEY);
    this.save = null;
    this.mode = 'title';
    this.player.reset(96, 96, 0);
    this.police.setStars(0);
    this.missions.reset();
    this.cash = PLAYER.startCash;
    this.titleScreen();
  }

  busted() {
    if (this.mode !== 'play' && this.mode !== 'paused') return;
    this.mode = 'busted';
    this.audio.busted();
    this.police.setStars(0);
    if (document.pointerLockElement) document.exitPointerLock();
    this.showOverlay(`
      <div class="panel busted">
        <h2>BUSTED</h2>
        <p class="story">The Meridian Port Authority reads you your rights in a bored voice. The desk
        sergeant takes $150 and your dignity.</p>
        <div class="buttons"><button data-action="respawn">WALK OUT</button></div>
      </div>`, 'busted');
  }

  wasted() {
    if (this.mode !== 'play') return;
    this.mode = 'wasted';
    this.audio.busted();
    this.police.setStars(0);
    if (document.pointerLockElement) document.exitPointerLock();
    this.showOverlay(`
      <div class="panel wasted">
        <h2>WASTED</h2>
        <p class="story">Dockside clinic, fluorescent lights, a bill you can't read. You wake up
        lighter in the wallet and heavier in the head.</p>
        <div class="buttons"><button data-action="respawn">GET UP</button></div>
      </div>`, 'wasted');
  }

  respawn() {
    this.cash = Math.max(0, this.cash - 150);
    this.player.health = PLAYER.maxHealth;
    this.player.vel.set(0, 0, 0);
    this.player.pos.set(150, 0.2, -150);
    this.player.placeAt(150, -150, 0);
    this.player.show();
    this.player.y = 0;
    this.player.vy = 0;
    this.police.clear();
    this.mode = 'play';
    this.hideOverlay();
  }

  // --- save -------------------------------------------------------------
  loadSave() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.cash !== 'number') return null;
      return data;
    } catch {
      return null;
    }
  }

  saveGame(notify) {
    const car = this.player.inCar;
    this.save = {
      cash: this.cash,
      mission: Math.min(this.missions.index, MISSIONS.length - 1),
      step: this.missions.step,
      x: car ? car.pos.x : this.player.pos.x,
      z: car ? car.pos.z : this.player.pos.z,
      heading: this.player.heading,
      clock: this.clockMinutes,
      stars: this.police.stars,
      stamp: this.time,
    };
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch { /* private mode: play on without saving */ }
    if (notify) {
      this.promptFlash = 1.2;
      this.audio.blip(980, 0.08);
    }
  }

  loadGame() {
    const s = this.save;
    if (!s) return;
    this.cash = s.cash ?? PLAYER.startCash;
    this.player.reset(s.x ?? 96, s.z ?? 96, s.heading ?? 0);
    this.clockMinutes = s.clock ?? 19 * 60 + 40;
    this.police.setStars(Math.min(2, s.stars ?? 0));
    const index = Math.min(s.mission ?? 0, MISSIONS.length - 1);
    this.missions.start(index);
    this.missions.step = Math.min(s.step ?? 0, MISSIONS[index].steps.length - 1);
  }

  // --- camera -----------------------------------------------------------
  updateCamera(dt) {
    const car = this.player.inCar;
    const target = car ? car.pos : new THREE.Vector3(this.player.pos.x, this.player.y, this.player.pos.z);

    if (car) {
      // Chase camera: tucked in behind the car and low to the road, with lag. Speed moves it
      // back a little, not a lot, so the car always stays a readable size on screen.
      const speed = Math.abs(car.speed);
      const dist = 6.9 + speed * 0.085;
      const height = 2.75 + speed * 0.018;
      const back = car.heading + Math.PI;
      const want = new THREE.Vector3(
        target.x + Math.sin(back) * dist,
        height,
        target.z + Math.cos(back) * dist,
      );
      this.cameraPos.lerp(want, Math.min(1, 7 * dt));
      this.camTarget.lerp(new THREE.Vector3(target.x, 1.0, target.z), Math.min(1, 11 * dt));
      const shake = this.vehicles.shake;
      this.camera.position.copy(this.cameraPos);
      if (shake > 0.01) {
        this.camera.position.x += Math.sin(this.time * 90) * shake * 0.35;
        this.camera.position.y += Math.cos(this.time * 110) * shake * 0.25;
      }
      this.camera.lookAt(this.camTarget);
    } else {
      // Orbit camera behind the character, driven by mouse movement.
      const dist = 6.4;
      const height = 2.2 + this.cameraPitch * 4.2;
      const want = new THREE.Vector3(
        target.x - Math.sin(this.cameraYaw) * dist,
        height,
        target.z - Math.cos(this.cameraYaw) * dist,
      );
      this.cameraPos.lerp(want, Math.min(1, 9 * dt));
      this.camera.position.copy(this.cameraPos);
      this.camera.lookAt(new THREE.Vector3(target.x, 1.35, target.z));
    }
  }

  // --- actions ----------------------------------------------------------
  tryEnterExit() {
    if (this.player.inCar) {
      const car = this.player.inCar;
      const side = new THREE.Vector3(Math.cos(car.heading), 0, -Math.sin(car.heading));
      const p = { x: car.pos.x + side.x * 2.2, z: car.pos.z + side.z * 2.2 };
      this.world.resolveCircle(p, PLAYER.radius);
      this.player.inCar = null;
      car.driver = null;
      car.vel.multiplyScalar(0.2);
      this.player.placeAt(p.x, p.z, car.heading);
      this.player.show();
      this.audio.silenceEngine();
      return;
    }
    const car = this.vehicles.nearest(this.player.pos, 4.2, (c) => !c.wrecked);
    if (!car) return;
    if (car.driver === 'police') {
      this.crime({ stars: 2, label: 'Grand theft auto' });
    } else {
      this.crime({ stars: 1, label: 'Grand theft auto' });
    }
    car.driver = 'player';
    this.player.inCar = car;
    this.player.hide();
    this.player.input = this.input;
    this.player.pos.set(car.pos.x, 0, car.pos.z);
    this.audio.blip(560, 0.1);
  }

  // Record a crime for this tick. police.wanted() raises the stars exactly once, so a crime
  // committed and then read back in the same frame never counts double.
  crime(evt) {
    const event = { stars: evt.stars ?? 0, label: evt.label ?? 'Crime', at: this.time };
    this.crimes.push(event);
    if (evt.label) this.lastCrime = event.label;
    return event;
  }

  // The stable "wanted" responder: crimes reported this tick, collapsed to at most one
  // star-step per second so a pile-up does not jump straight to five stars.
  reportCrimes(dt) {
    this.reportCooldown = Math.max(0, (this.reportCooldown ?? 0) - dt);
    let stars = 0;
    for (const c of this.crimes) stars = Math.max(stars, c.stars);
    if (stars > 0 && this.reportCooldown <= 0) {
      this.reportCooldown = 1.1;
      this.police.addStars(stars);
    }
    this.police.wanted(dt, this.player, this.crimes);
  }

  fire() {
    const p = this.player;
    if (p.weapon !== 'pistol' || p.reloading > 0 || p.fireCooldown > 0 || p.inCar) return;
    if (p.ammo <= 0) {
      this.audio.blip(180, 0.06, 'square', 0.1);
      return;
    }
    p.ammo -= 1;
    p.fireCooldown = 60 / WEAPON.pistol.rpm;
    const dir = new THREE.Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw));
    const origin = new THREE.Vector3(p.pos.x, 1.35, p.pos.z);
    p.heading = this.cameraYaw;
    this.audio.gunshot();
    this.muzzle.position.copy(origin).addScaledVector(dir, 0.7);
    this.muzzle.visible = true;
    this.muzzle.scale.setScalar(1 + Math.random() * 0.4);
    this.muzzleLight.position.copy(this.muzzle.position);
    this.muzzleLight.intensity = 8;

    const hitPed = this.traffic.nearestPed(origin, 30);
    const ray = new THREE.Vector2();
    let hitSomething = false;
    if (hitPed) {
      ray.set(hitPed.pos.x - p.pos.x, hitPed.pos.z - p.pos.z);
      const dist = ray.length();
      const along = ray.clone().normalize().dot(new THREE.Vector2(dir.x, dir.z));
      if (dist < WEAPON.pistol.range && along > 0.94) {
        hitPed.alive = false;
        hitPed.vy = 2.4;
        hitSomething = true;
        this.crime({ stars: 2, label: 'Homicide' });
        this.traffic.scatter(hitPed.pos.x, hitPed.pos.z, 26);
        this.hitmarkTimer = 0.2;
      }
    }
    if (!hitSomething) {
      for (const unit of this.police.units) {
        const dx = unit.car.pos.x - p.pos.x;
        const dz = unit.car.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 26 && (dx * dir.x + dz * dir.z) / d > 0.95) {
          unit.car.damage(WEAPON.pistol.damage * 0.5);
          this.crime({ stars: 1, label: 'Assaulting an officer' });
          this.hitmarkTimer = 0.2;
          break;
        }
      }
    }
    this.addTracer(origin, dir);
    if (hitSomething) this.audio.blip(1200, 0.05);
  }

  addTracer(origin, dir) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      origin.clone(),
      origin.clone().addScaledVector(dir, 40),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.75 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  punch() {
    const p = this.player;
    if (p.punchTimer > 0 || p.inCar) return;
    p.punchTimer = 0.32;
    this.audio.punch();
    const dir = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    const target = this.traffic.nearestPed(new THREE.Vector3(p.pos.x, 0, p.pos.z).addScaledVector(dir, 1.4), PLAYER.punchRange);
    if (target) {
      target.alive = false;
      target.vy = 2;
      this.crime({ stars: 2, label: 'Assault' });
      this.hitmarkTimer = 0.2;
      this.audio.crash(0.4);
    }
  }

  reload() {
    const p = this.player;
    if (p.reloading > 0 || p.ammo >= WEAPON.pistol.mag || p.reserve <= 0) return;
    p.reloading = WEAPON.pistol.reload;
    this.audio.blip(420, 0.06, 'square', 0.1);
    setTimeout(() => {
      const need = WEAPON.pistol.mag - p.ammo;
      const take = Math.min(need, p.reserve);
      p.ammo += take;
      p.reserve -= take;
    }, WEAPON.pistol.reload * 1000);
  }

  // --- main loop --------------------------------------------------------
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  step(now) {
    requestAnimationFrame(this.step);
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(0.05, Math.max(0.0005, raw));
    if (this.shot) {
      // A staged screenshot is a frozen frame: no simulation, just the pose shots.js set up.
      this.world.ramp(dt, this.camera);
    } else if (this.mode === 'play') this.tick(dt);
    else this.idleTick(dt);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    if (this.shot) this.shot.after(dt);
  }

  idleTick(dt) {
    // The city keeps moving behind menus so the title screen is alive.
    this.time += dt;
    this.vehicles.step(dt, this.player, this.police, () => {});
    this.traffic.update(dt, this.player, 0);
    this.missions.tick(dt);
    this.updateCamera(dt);
    if (this.shot) this.shot.tick(dt);
  }

  tick(dt) {
    this.time += dt;
    this.crimes.length = 0;
    const input = this.input;

    if (input.hit('pause')) {
      this.pause();
      return;
    }
    if (input.hit('mute')) {
      const muted = this.audio.toggleMute();
      this.promptFlash = 2;
      this.promptText = muted ? 'Sound off' : 'Sound on';
    }
    if (input.hit('enter')) this.tryEnterExit();
    if (input.hit('punch')) this.punch();
    if (input.hit('reload')) this.reload();
    if (input.hit('weapon1')) this.player.weapon = 'pistol';
    if (input.hit('weapon2')) this.player.weapon = 'fists';
    if (input.fire && this.player.weapon === 'pistol') this.fire();

    const extra = input.consumeMouse();
    this.cameraYaw -= extra.x * 0.0032;
    this.cameraPitch = Math.max(-0.2, Math.min(0.9, this.cameraPitch + extra.y * 0.0018));

    this.player.input = input;
    this.player.update(dt, input, this.world, this.cameraYaw);
    if (this.player.inCar) {
      const car = this.player.inCar;
      this.player.pos.set(car.pos.x, 0, car.pos.z);
      this.player.heading = car.heading;
    }

    this.vehicles.step(dt, this.player, this.police, (car, speed, other) => {
      if (car === this.player.inCar || other === this.player.inCar) this.damageFlash = 0.5;
    });
    this.traffic.update(dt, this.player, this.police.stars);
    this.traffic.checkPedHits(this.player.inCar, (ped) => {
      this.crime({ stars: 1, label: 'Vehicular manslaughter' });
      this.damageFlash = 0.4;
    });

    // Crimes the city commits against the player still count toward the wanted level.
    const car = this.player.inCar;
    if (car && car.wrecked) {
      this.player.inCar = null;
      car.driver = null;
      this.player.placeAt(car.pos.x, car.pos.z, car.heading);
      this.player.show();
      this.wasted();
      return;
    }

    this.reportCrimes(dt);
    this.police.update(dt, this.player, () => this.busted(), () => this.wasted());

    if (this.player.health <= 0) {
      this.wasted();
      return;
    }

    this.missions.update(dt, this.player);
    this.missions.tick(dt);
    this.clockMinutes = (this.clockMinutes + dt * (1440 / 420)) % 1440;

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.75;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        this.tracers.splice(i, 1);
      }
    }
    if (this.muzzle.visible) {
      this.muzzleTimer = (this.muzzleTimer ?? 0) + dt;
      if (this.muzzleTimer > 0.05) {
        this.muzzle.visible = false;
        this.muzzleLight.intensity = 0;
        this.muzzleTimer = 0;
      }
    }

    this.updatePrompt();
    this.audio.setEngine(car ? Math.min(1, Math.abs(car.speed) / car.spec.maxSpeed) : 0, this.input.down('forward'));
    if (!car) this.audio.silenceEngine();
    this.audio.tickMusic(dt, this.police.stars);

    this.updateCamera(dt);
    this.world.ramp(dt, this.camera);
    this.hud.update(dt, {
      player: this.player,
      police: this.police,
      missions: this.missions,
      vehicles: this.vehicles,
      clock: this.clockMinutes,
      game: this,
    });
    this.hitmarkTimer = Math.max(0, this.hitmarkTimer - dt);
    document.getElementById('status').textContent =
      `${this.missions.objectiveText()} · ${this.police.stars} stars · $${this.cash}`;
    if (this.shot) this.shot.tick(dt);
  }

  updatePrompt() {
    const car = this.player.inCar;
    if (this.promptFlash > 0) {
      this.promptFlash -= 1 / 60;
      this.prompt = this.promptText;
      return;
    }
    if (car) {
      this.prompt = 'E — get out   ·   Shift — handbrake   ·   H — horn';
      return;
    }
    const near = this.vehicles.nearest(this.player.pos, 4.2, (c) => !c.wrecked);
    this.prompt = near ? 'E — take the car' : null;
  }

  // --- screenshot staging ----------------------------------------------
  applyShotPreset() {
    const params = new URLSearchParams(location.search);
    const shot = params.get('shot');
    if (!shot) return;
    this.mode = 'play';
    this.hideOverlay();
    window.__shotReady = false;
    this.shot = applyShot(this, shot);
  }
}

function gridSpot(ix, iz, offset) {
  return (ix - CITY.grid / 2) * CITY.pitch + offset;
}

const game = new Game();
window.__game = game;
