// Port Meridian's entrypoint (Node 22, standard library only).
//
// It hands in the game this repository's game/ folder holds: plain static files a desktop
// browser loads offline, no build step and no network request. It copies game/ and
// screenshots/ beside this file into the output directory (MAKEFUN_OUTPUT_DIR, default
// /output) and writes dossier.json there with the kit's vendored makefun-game.ts library.
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');
const indexPath = join(gameDir, 'index.html');

function fail(message) {
  console.error(`port-meridian: ${message}`);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  fail(`game/index.html is missing (looked in ${gameDir}); the game must ship its page`);
}
const indexSize = statSync(indexPath).size;
if (indexSize === 0) fail('game/index.html is empty');

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });

if (!existsSync(shotsDir)) fail('screenshots/ is missing; the entry needs 3 or 4 frames');
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

const shots = readdirSync(join(out, 'screenshots')).filter((n) => /\.(jpe?g|png)$/i.test(n)).sort();
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image(s); the entry needs 3 or 4`);
for (const name of shots.slice(0, 4)) {
  const bytes = statSync(join(out, 'screenshots', name)).size;
  const kib = (bytes / 1024).toFixed(1);
  console.log(`screenshot ${name}: ${kib} KiB`);
}

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
const dossierPath = join(out, 'dossier.json');
writeFileSync(dossierPath, dossier);

const dossierKib = (statSync(dossierPath).size / 1024).toFixed(1);
console.log(`wrote ${shots.length > 4 ? 4 : shots.length} screenshots and dossier.json (${dossierKib} KiB) to ${out}`);
