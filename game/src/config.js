// Tuning and palette for PORT MERIDIAN. Every magic number the simulation uses lives
// here so the feel of the game can be adjusted in one place.
export const CITY = {
  grid: 12,          // blocks per side
  pitch: 52,         // metres between road centre lines
  roadWidth: 14,
  sidewalk: 4,
  blockPad: 19,      // half width of the buildable cell (pitch/2 - roadWidth/2)
  bound: 312,        // city half extent (grid * pitch / 2)
  waterAt: 336,      // quay edge; water fills everything east of it
};

export const PALETTE = {
  skyTop: 0x131a33,
  skyHorizon: 0xf5885a,
  fog: 0x2a2c46,
  sun: 0xffb27a,
  ground: 0x23242e,
  asphalt: 0x1b1d24,
  sidewalk: 0x3a3c48,
  line: 0xd8d2b4,
  water: 0x0b1c2c,
  neon: [0xff4d6d, 0x36e0c8, 0xffc23d, 0x9b6bff, 0x4dd0ff],
  buildingTints: [0x4a4e63, 0x3d4258, 0x555a70, 0x2f3446, 0x5d5568, 0x33384c],
  carColors: [0xb5313c, 0x2e6fa8, 0xd9d2c4, 0x2b2f35, 0x2f8f6b, 0xdc9b2c, 0x6d4b8f],
};

export const CAR_TYPES = {
  sedan:   { length: 4.4, width: 1.9, height: 1.35, mass: 1.0, maxSpeed: 27, accel: 12, grip: 1.0,  turn: 2.2, hp: 100, value: 180 },
  taxi:    { length: 4.6, width: 1.95, height: 1.5, mass: 1.05, maxSpeed: 25, accel: 11, grip: 0.95, turn: 2.0, hp: 100, value: 210 },
  sports:  { length: 4.5, width: 2.0, height: 1.12, mass: 0.85, maxSpeed: 41, accel: 19, grip: 1.2,  turn: 2.6, hp: 130, value: 900 },
  truck:   { length: 6.2, width: 2.35, height: 2.3, mass: 1.9, maxSpeed: 19, accel: 7.5, grip: 0.8,  turn: 1.4, hp: 180, value: 260 },
  police:  { length: 4.7, width: 1.95, height: 1.45, mass: 1.1, maxSpeed: 33, accel: 15, grip: 1.1,  turn: 2.3, hp: 140, value: 0 },
};

export const PLAYER = {
  radius: 0.42,
  height: 1.8,
  walk: 4.0,
  sprint: 7.4,
  jump: 6.2,
  gravity: 20,
  maxHealth: 100,
  startCash: 250,
  punchRange: 2.1,
  punchDamage: 26,
};

export const WEAPON = {
  pistol: { name: 'MERIDIAN 9', damage: 34, rpm: 320, spread: 0.02, reload: 1.35, mag: 12, range: 90 },
};

export const POLICE = {
  starDecay: 20,          // seconds with no crime before a star drops
  maxStars: 5,
  unitSpeed: 34,
  ramRange: 60,
  spawnRange: 170,
  maxUnits: 7,
  arrestRange: 2.2,
  arrestTime: 1.6,
};

export const MISSION = {
  markerRadius: 3.4,
  waypointReach: 5.5,
};

export const TIME = {
  step: 1 / 60,
  maxFrame: 0.1,
  dayLength: 420,        // seconds for a full clock cycle
  startMinutes: 19 * 60 + 40,
};

// Road grid helpers shared by the world, traffic and police.
export const gridLine = (i) => (i - CITY.grid / 2) * CITY.pitch;
export const cellCentre = (i) => (i + 0.5 - CITY.grid / 2) * CITY.pitch;

export function nearestGridLine(d) {
  return Math.max(0, Math.min(CITY.grid, Math.round(d / CITY.pitch + CITY.grid / 2)));
}
