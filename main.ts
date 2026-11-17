// PORT MERIDIAN entrypoint (Node 22, standard library only).
//
// The game is this directory's game/ folder: plain static files a desktop browser loads offline
// (game/index.html plus its ES modules and a vendored three.js), so there is no build step here.
// This program is the plumbing the grader runs: it copies game/ and screenshots/ beside this file
// into /output and writes /output/dossier.json, the summary the judge reads, with the kit's
// vendored buildDossier library.
//
// Serve the game locally with `node serve.ts` and open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(here, 'game');
const shotDir = join(here, 'screenshots');

// Fail loudly instead of handing in a dossier with no game behind it.
if (!existsSync(join(gameDir, 'index.html'))) {
  console.error(`missing ${join(gameDir, 'index.html')}: the game ships as static files under game/`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(shotDir)) cpSync(shotDir, join(out, 'screenshots'), { recursive: true });

// The judge sees the screenshots first, so report what was actually copied: four frames of the
// game's own code, the first by name the cover, every one under the 256 KiB image cap.
const shots = readdirSync(shotDir)
  .filter((name) => !name.startsWith('.') && /\.(png|jpg|jpeg)$/i.test(name))
  .sort();

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// One line per screenshot, then the dossier's own size, so a local run says what the judge will see.
for (const name of shots) {
  const { size } = statSync(join(out, 'screenshots', name));
  console.log(`  ${name} ${(size / 1024).toFixed(0)} KiB`);
}
const dossier = statSync(join(out, 'dossier.json')).size;
console.log(`wrote ${out}: ${shots.length} screenshots, dossier.json ${(dossier / 1024).toFixed(0)} KiB`);
