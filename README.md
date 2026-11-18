# PORT MERIDIAN

[![Make GTA 6 — make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank on the gta6-01 board](https://make.fun/badge/gta6-01/metawo14/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward on the gta6-01 board](https://make.fun/badge/gta6-01/metawo14/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

**Bounty page:** <https://make.fun/bounty/gta6-01>

A dusk-lit harbour city of neon, wet asphalt and dirty money, built from scratch for the
make.fun **Make GTA 6** competition. The docks took your brother's boat, his name and nearly
you; the Port Authority runs the town on bribes and bad coffee, and the crews run it on nerve.
You land at the dock gate with a scarf, a pistol with one magazine and $250, steal a car that
isn't yours, and work up from courier to kingpin across four linked jobs while the harbour
police decide how much they care. It is a browser game — no installer, no build step, no
network calls — and every building, car, pedestrian, sound and line of story is generated or
written for this entry.

## What is in it

- **A procedural city**: 12 × 12 blocks of roads, pavements, kerbs, lane dashes, crosswalks,
  110 lit buildings with window and neon glow, street lamps with warm pools of light, hydrants,
  crates, palms along the waterfront, a shader sky dome, a low sun, fog and a dark sea. The
  default seed (7) always rebuilds the same city; `?seed=` changes it.
- **Five car classes** — sedan, sports, taxi, truck and police cruiser — each built from boxes
  with a glass cabin, steering front wheels, headlights with dim beams, brake lights that
  flare, and a police light bar with red/blue halos and a spill pool on the road.
- **Arcade handling**: acceleration, braking, a lateral slide that grip bleeds off, a handbrake
  that steps the tail out, steering that weakens with speed, skid marks, dust, smoke from a
  damaged engine, and collisions that push cars apart and damage them.
- **A player on foot**: an articulated low-poly figure with a red scarf, walk/sprint/jump, a
  punch animation, a 12-round pistol with reload, muzzle flash, tracer and an aim pose.
- **Living streets**: 24 traffic cars that keep their lane, slow for junctions, turn and keep a
  gap; 34 pedestrians who wander, cross at corners and scatter when a crime or a fast car
  comes near.
- **A wanted system**: zero to five stars fed only by crimes (car theft, homicide, assault,
  vehicular manslaughter), police cruisers that spawn at the map edge and chase, ram and
  arrest, heat that decays when the tail is shaken, and a busted flow that costs $150.
- **Four linked jobs** with a beacon, a brief, step-by-step objectives, cash and a story that
  ends when you own the city.
- **A HUD** with health, cash, wanted stars, a clock and phase, a weapon chip, an objective
  card, a live minimap, a speedometer with gears, context prompts, a mission banner and a
  damage vignette.
- **Synthesised sound**: engine, siren, bassline and one-shot effects from WebAudio. No audio
  files ship.

## Run it

There is no build step and nothing to install.

```sh
# from the repository root
node serve.ts            # serves game/ at http://127.0.0.1:8080/
```

Open <http://127.0.0.1:8080/> in a desktop Chrome (or any modern browser with WebGL) and press
**START**. Any static file server works too — serve the `game/` folder as the site root. Add
`?seed=7` to pin the city.

The grader entrypoint builds a dossier without a browser:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Controls

| Input | On foot | In a car |
| --- | --- | --- |
| `W A S D` / arrows | move (camera-relative) | throttle, brake, steer |
| Mouse | look (click to lock the pointer) | — |
| `Shift` | sprint | handbrake |
| `Space` | jump | — |
| `E` | take the nearest car | get out |
| Left click | fire the pistol | — |
| `F` | punch | — |
| `R` | reload | — |
| `1` / `2` | pistol / fists | — |
| `H` | — | horn |
| `P` or `Esc` | pause (autosaves) | pause (autosaves) |
| `M` | mute | mute |

## The four jobs — Rookie to Kingpin

1. **First Wheels** — steal any car and bring it to the lock-up on Kestrel Row. *$450*
2. **Payback** — a runner skipped a debt; find his sports car by the marina and wreck it. *$800*
3. **Hot Package** — pick up the case at the marina and run it north to the quay with the heat
   on you. *$1,400*
4. **The Big Score** — lift the sports car from the harbour deck, shake the tail until the
   wanted level is zero, then reach the hideout. *$2,600*

Completing a job pays out, cools the wanted level by a star and starts the next one a moment
later. Pause to save; the title screen offers CONTINUE for the best save in local storage.

## Screenshots

All four frames are captured from this build with `tools/capture.mjs` and live in
`screenshots/`:

- **1-chase.jpg** — the cover: a red sports car mid-drift with two cruisers closing, three
  stars, smoke and a beacon down the boulevard (`?shot=chase&seed=7`)
- **2-onfoot.jpg** — the player on the pavement beside a damaged sedan, one star, a beacon
  down the avenue (`?shot=onfoot&seed=7`)
- **3-mission.jpg** — the marina case glowing under a beacon with cruisers closing
  (`?shot=mission&seed=7`)
- **4-night.jpg** — a green sports car at night with headlights and a light pool, a cruiser
  behind (`?shot=night&seed=7`)

## Tools

- `node tools/capture.mjs <url> <file.jpg> [w] [h] [wait]` — headless frame capture.
- `node tools/playtest.mjs` — the headless playtest: fourteen labelled steps through the whole
  game (title, walk, steal, drive, the four jobs, combat, save, busted, wasted), zero console
  problems required, saves a final frame.
- `python3 tools/verify.py screenshots/*.jpg` — six checks per staged frame.
- `node tools/probe.mjs <url>` — load the page and report console errors and counts.

## Layout

```
game/index.html          the only page: canvas, HUD, overlays, import map
game/src/                plain ES modules, one job each
game/vendor/             vendored three.js (third-party, unmodified)
tools/                   headless capture, playtest and verification helpers
screenshots/             the four frames
main.ts                  grader entrypoint: copies game/ + screenshots/, writes dossier.json
serve.ts                 tiny static server for game/ on port 8080
shots.json               the four screenshot names and their queries
```

## Licence

MIT. The game, its city, story, characters, art and sound are original to this entry. three.js
is vendored under its own MIT licence in `game/vendor/`.
