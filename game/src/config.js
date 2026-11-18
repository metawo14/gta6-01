// Port Meridian — shared configuration.
// Every number that shapes the city, the cars and the clock lives here so the world,
// the vehicles and the screenshot staging can all agree on one set of values.

export const CITY = {
  blocks: 12,            // 12 x 12 city blocks
  pitch: 64,             // metres between road centres
  roadWidth: 15,         // asphalt width
  pavement: 5,           // pavement width either side
  bound: 384,            // playable half-extent
  seaEdge: 330,          // the sea starts about here on the east side
  defaultSeed: 7,
  buildingCount: 110,    // the generator aims for about this many blocks with buildings
  lampSpacing: 32,
};

// The grid line positions: roads run along these x and z values.
export const GRID = [];
for (let i = 0; i <= CITY.blocks; i++) GRID.push((i - CITY.blocks / 2) * CITY.pitch);

// A block's buildable interior, inset past the road and pavement.
export const BLOCK_INSET = CITY.roadWidth / 2 + CITY.pavement;

export const PALETTE = {
  skyTop: 0x101a3a,
  skyMid: 0x3a3a6e,
  skyHorizon: 0xe08a52,
  fog: 0x232a44,
  sun: 0xffb070,
  hemiSky: 0x6b82c8,
  hemiGround: 0x2e2620,
  asphalt: 0x3a4050,
  pavement: 0x4a4d59,
  kerb: 0x5c5f6b,
  building: [0x2a2f42, 0x33304a, 0x272b36, 0x36323f, 0x2e3a44, 0x3a3448],
  window: 0xffd9a0,
  neon: [0x37f0d0, 0xff5c8a, 0xa06cff, 0x58c8ff, 0xffc247],
  sodium: 0xffb35c,
  water: 0x0e2234,
  haze: 0x8fa0c8,
};

// Five car classes. Handling is deliberately arcade: strong numbers, short inputs.
export const CAR_CLASSES = {
  sedan: {
    label: 'Sedan', length: 4.4, width: 1.9, height: 1.35,
    accel: 15, topSpeed: 27, reverseSpeed: 9, turnRate: 1.9, grip: 7.2,
    health: 100, mass: 1.0, color: 0x2c5fa8, roof: 0xdfe3ea, kind: 'civilian',
  },
  sports: {
    label: 'Sports', length: 4.3, width: 2.0, height: 1.05,
    accel: 23, topSpeed: 38, reverseSpeed: 10, turnRate: 2.5, grip: 6.0,
    health: 82, mass: 0.9, color: 0xc22a3a, roof: 0x1b1d24, kind: 'civilian',
  },
  taxi: {
    label: 'Taxi', length: 4.5, width: 1.95, height: 1.4,
    accel: 13.5, topSpeed: 25, reverseSpeed: 8.5, turnRate: 1.8, grip: 7.0,
    health: 96, mass: 1.05, color: 0xe8b62a, roof: 0xf2d060, kind: 'civilian', roofSign: true,
  },
  truck: {
    label: 'Truck', length: 6.6, width: 2.3, height: 2.5,
    accel: 9.5, topSpeed: 20, reverseSpeed: 6.5, turnRate: 1.3, grip: 8.2,
    health: 150, mass: 1.7, color: 0x4a5566, roof: 0x3a4352, kind: 'civilian', cargo: true,
  },
  police: {
    label: 'Cruiser', length: 4.7, width: 2.0, height: 1.45,
    accel: 19, topSpeed: 33, reverseSpeed: 9.5, turnRate: 2.1, grip: 6.8,
    health: 120, mass: 1.15, color: 0x1c2a4a, roof: 0xe8ecf2, kind: 'police', lightBar: true,
  },
};
export const CAR_NAMES = Object.keys(CAR_CLASSES);

export const PLAYER = {
  walkSpeed: 5,
  sprintSpeed: 8.5,
  jumpSpeed: 6.4,
  gravity: 21,
  radius: 0.42,
  height: 1.8,
  health: 100,
  enterRange: 4,
};

export const WEAPONS = {
  fists: { name: 'Fists', ammo: false },
  pistol: {
    name: 'Pistol', ammo: true,
    magazine: 12, reserve: 48, rpm: 300, reloadTime: 1.4,
    range: 46, damage: 26, spread: 0.035,
  },
};

export const CLOCK = {
  startMinutes: 19 * 60 + 40,   // 19:40, dusk
  dayRealSeconds: 7 * 60,        // one in-game day every seven real minutes
};

export const SAVE_KEY = 'port-meridian-save-v1';

// Wanted level tuning.
export const HEAT = {
  starStepCooldown: 1.0,   // at most one star-step per second
  decayIdle: 12,           // seconds with no police near before heat decays
  maxUnits: 9,
  perStar: 2,              // units ≈ stars * 2 - 1
  spawnEvery: 3.2,
  bustRadius: 3,
  bustSeconds: 2.2,
};

export const MISSION_DEFS = [
  {
    id: 'wheels',
    name: 'First Wheels',
    brief: 'The lock-up on Kestrel Row needs a car, and the docks are full of them. Take one that is not yours.',
    reward: 450,
    stars: 1,
  },
  {
    id: 'payback',
    name: 'Payback',
    brief: 'A runner skipped his debt. His sports car is parked by the marina — wreck it and the message lands.',
    reward: 800,
    stars: 2,
  },
  {
    id: 'package',
    name: 'Hot Package',
    brief: 'A case is waiting at the marina. Pick it up and run it north to the quay with the heat on your tail.',
    reward: 1400,
    stars: 2,
  },
  {
    id: 'score',
    name: 'The Big Score',
    brief: 'Lift the sports car from the harbour deck, shake the tail until the wanted level is gone, then reach the hideout.',
    reward: 2600,
    stars: 3,
  },
];

// Named places the jobs point at.
export const PLACES = {
  lockup: { x: 214, z: -40, label: 'Lock-up' },
  marina: { x: 282, z: -150, label: 'Marina' },
  northQuay: { x: 150, z: 190, label: 'North Quay' },
  hideout: { x: -240, z: 210, label: 'Hideout' },
  respawn: { x: 150, z: -150, label: 'North Quay' },
  start: { x: 96, z: -196, label: 'Dock Gate' },
};

export const WAYPOINT_RADIUS = 14;

export const TRAFFIC_COUNT = 24;
export const PED_COUNT = 34;

export const RENDER = {
  exposure: 1.5,
  fogNear: 90,
  fogFar: 620,
  fov: 62,
};
