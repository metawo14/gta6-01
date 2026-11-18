// Port Meridian — the grader entrypoint (Node 22+, standard library only).
//
// Run as `node main.ts`. It checks that game/index.html exists, copies the game folder and
// the screenshots folder into the output directory (MAKEFUN_OUTPUT_DIR, default /output), then
// writes dossier.json there with the kit's vendored buildDossier library.
//
// Outside the grader:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const GAME = join(HERE, 'game');
const SHOTS = join(HERE, 'screenshots');
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function fail(message) {
  console.error(`main.ts: ${message}`);
  process.exit(1);
}

// 1. The game has to be there, and it has to be a page.
if (!existsSync(GAME) || !statSync(GAME).isDirectory()) {
  fail(`no game/ directory beside main.ts at ${GAME}`);
}
if (!existsSync(join(GAME, 'index.html'))) {
  fail('game/index.html is missing: a game is a directory of static files, its index.html at the root');
}
if (!existsSync(join(GAME, 'src', 'main.js'))) {
  fail('game/src/main.js is missing: the game entry module is required');
}

// 2. Copy the game and the screenshots into the output directory.
mkdirSync(OUT, { recursive: true });
cpSync(GAME, join(OUT, 'game'), { recursive: true });
if (existsSync(SHOTS)) {
  cpSync(SHOTS, join(OUT, 'screenshots'), { recursive: true });
} else {
  fail('screenshots/ is missing: an entry ships three or four screenshots');
}

// 3. Report each screenshot with its size in KiB.
const shotsDir = join(OUT, 'screenshots');
const shots = readdirSync(shotsDir)
  .filter((name) => /\.(png|jpe?g)$/i.test(name))
  .sort();
if (shots.length === 0) fail('screenshots/ holds no PNG or JPEG');
for (const name of shots) {
  const bytes = statSync(join(shotsDir, name)).size;
  console.log(`  ${name} — ${(bytes / 1024).toFixed(1)} KiB`);
}

// 4. Write the dossier with the kit's own library and the grader's caps.
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};
let dossier;
try {
  dossier = buildDossier(OUT, caps);
} catch (err) {
  fail(`buildDossier refused the entry: ${err && err.message ? err.message : err}`);
}
const dossierPath = join(OUT, 'dossier.json');
writeFileSync(dossierPath, dossier);
console.log(`wrote ${shots.length} screenshot${shots.length === 1 ? '' : 's'} and dossier.json (${dossier.length} bytes) at ${dossierPath}`);
