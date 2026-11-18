// Port Meridian — shared constants for the city, the cars, the player and the HUD.
// Everything here is plain data: the simulation modules read it and never write it.

export const CITY = {
  seed: 7,
  blocks: 12, // a 12 by 12 block grid
  pitch: 64,
  roadWidth: 15,
  pavement: 5,
  bound: 384,
  waterX: 330,
  seaWall: 327,
  lampSpacing: 32,
};

// Road centre lines run at multiples of the pitch from -384 to +384.
export const ROAD_MIN = -CITY.pitch * (CITY.blocks / 2);
export const ROAD_MAX = CITY.pitch * (CITY.blocks / 2);
export const ROADS = (() => {
  const out = [];
  for (let i = 0; i <= CITY.blocks; i++) out.push(ROAD_MIN + i * CITY.pitch);
  return out;
})();

export const CLOCK = {
  startMinutes: 19 * 60 + 40, // 19:40, dusk
  dayMinutes: 24 * 60,
  realSecondsPerDay: 7 * 60, // one in-game day every seven real minutes
};

export const COLORS = {
  skyTop: 0x121d3d,
  skyMid: 0x2b3a68,
  skyHorizon: 0xe8864a,
  fog: 0x28324e,
  asphalt: 0x14161d,
  asphaltEdge: 0x1b1e27,
  lane: 0xb9b2a0,
  kerb: 0x4a4f5c,
  pavement: 0x3c4048,
  water: 0x0d2a3a,
  sodium: 0xffb066,
  teal: 0x38f0dc,
  pink: 0xff4f9d,
  window: 0xffd9a0,
  concrete: 0x2c3240,
  buildingColors: [0x2a3040, 0x333a4c, 0x3c3a4a, 0x2b3742, 0x403a44, 0x343040],
  carColors: {
    sedan: [0x2f6fd0, 0xb8bcc6, 0x7a1e26, 0x1f6d5a, 0x2c2f36],
    sports: [0xd22b2b, 0x1ec27a, 0xf0f0f0, 0x222228],
    taxi: [0xf0b31c],
    truck: [0x8a8f9a, 0x5a6170, 0x2f5d3a],
    police: [0x1b2c55],
  },
};

// Car classes. Units are metres and metres per second; the speedometer multiplies by 3.6.
export const CAR_SPECS = {
  sedan: {
    label: 'sedan',
    length: 4.6,
    width: 1.9,
    height: 1.42,
    accel: 14,
    brake: 22,
    top: 33,
    turn: 2.0,
    grip: 0.8,
    health: 100,
    mass: 1.0,
  },
  sports: {
    label: 'sports car',
    length: 4.5,
    width: 2.02,
    height: 1.12,
    accel: 22,
    brake: 26,
    top: 49,
    turn: 2.5,
    grip: 0.86,
    health: 88,
    mass: 0.95,
  },
  taxi: {
    label: 'taxi',
    length: 4.75,
    width: 1.94,
    height: 1.52,
    accel: 13,
    brake: 20,
    top: 31,
    turn: 1.9,
    grip: 0.78,
    health: 96,
    mass: 1.05,
  },
  truck: {
    label: 'truck',
    length: 6.6,
    width: 2.4,
    height: 2.55,
    accel: 9.5,
    brake: 16,
    top: 25,
    turn: 1.35,
    grip: 0.72,
    health: 170,
    mass: 1.6,
  },
  police: {
    label: 'police cruiser',
    length: 4.85,
    width: 2.02,
    height: 1.5,
    accel: 17,
    brake: 24,
    top: 39,
    turn: 2.15,
    grip: 0.84,
    health: 135,
    mass: 1.1,
  },
};

export const PLAYER = {
  health: 100,
  walk: 5.0,
  sprint: 8.5,
  jump: 6.4,
  gravity: 18,
  radius: 0.55,
  enterRange: 4.0,
  eye: 1.55,
};

export const WEAPONS = {
  pistol: {
    name: 'PISTOL',
    mag: 12,
    reserve: 48,
    rpm: 300,
    reload: 1.4,
    range: 46,
    damage: 34,
  },
  fists: { name: 'FISTS', mag: 0, reserve: 0, rpm: 90, reload: 0, range: 2.4, damage: 12 },
};

export const SAVE_KEY = 'port-meridian.save.v1';

export const MISSION_TARGETS = {
  lockup: { x: 214, z: -40, name: 'the lock-up on Kestrel Row' },
  runner: { x: 154, z: -88, name: "the runner's car" },
  marina: { x: 282, z: -150, name: 'the marina' },
  northQuay: { x: 150, z: 190, name: 'the north quay' },
  harbourDeck: { x: 270, z: -108, name: 'the harbour deck' },
  hideout: { x: -240, z: 210, name: 'the hideout' },
};

// Open areas kept clear of buildings so missions, traffic and the camera always have room.
export const RESERVED = [
  { x: 282, z: -150, r: 32 },
  { x: 270, z: -108, r: 20 },
  { x: 214, z: -40, r: 17 },
  { x: 150, z: 190, r: 18 },
  { x: -240, z: 210, r: 18 },
  { x: 150, z: -88, r: 12 },
];

export const SPAWN = { x: 90, z: -170, heading: Math.PI };
