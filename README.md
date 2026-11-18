<p align="center">
  <img src="https://make.fun/badge/gta6-01.svg" alt="make.fun gta6-01 competition badge">
  <img src="https://make.fun/badge/gta6-01/metawo14/gta6-01/rank.svg" alt="make.fun rank badge for this repository">
  <img src="https://make.fun/badge/gta6-01/metawo14/gta6-01/reward.svg" alt="make.fun reward badge for this repository">
</p>

# PORT MERIDIAN

A 3D open-world crime game that runs in a desktop browser from plain static files: no build
step, no install, no network request once the page is open. It is built for the
[make.fun gta6-01 "Make GTA 6" bounty](https://make.fun/bounty/gta6-01).

The docks took your brother's boat, his name and nearly you. The Port Authority runs this city
on bribes and bad coffee; the crews run it on nerve. You land in the harbour with two hundred
and fifty in your pocket, a pistol with a full magazine, and a lock-up on Kestrel Row that
nobody else wanted. Four jobs stand between the harbour mud and the top of the pile.

## What is in it

- **A whole city, generated from a seed.** A 12 by 12 block grid at dusk: 118 buildings with
  lit-window facades, neon signs, storefronts, street lamps with baked halos, hydrants, crates
  and palms down the waterfront. The sea runs along the east wall, the sky is a gradient shader
  with a low sun, and the whole thing rebuilds identically from `?seed=7`.
- **Five car classes you can actually drive.** Sedan, sports car, taxi, truck and police
  cruiser, each with its own dimensions, acceleration, top speed, turn rate, grip and health.
  Arcade handling: lateral slip bled away by grip, a handbrake that cuts grip and steps the tail
  out, steering that weakens with speed and reverses when reversing, skid marks, dust and smoke.
- **Cars built from boxes, with the details that sell it.** Three-layer bodies, glass cabins,
  steering front wheels that spin with speed, headlight lenses with dim beam cones and a faint
  pool on the road, tail lamps that flare under braking, and a police light bar with red and
  blue lenses, halos that alternate and a coloured spill on the ground.
- **A player on foot.** Articulated jacket-and-scarf figure with a walk cycle, sprint, jump,
  punch and aim poses. Twelve-round pistol with 48 in reserve, reload, muzzle flash, point
  light and tracers. Steal any car within reach: a civilian car costs one star, a cruiser two.
- **Traffic and pedestrians.** 24 lane-keeping cars that slow for junctions, keep a gap, take
  cross streets and turn around at the edge. 34 pedestrians who walk the pavements, wander,
  and run when a crime happens or a fast car comes near. Hit one hard and they go down.
- **Police and a five-star wanted level.** Cruisers spawn at the map edge, close with a lead,
  ram, and arrest you if they hold you on foot for two seconds. Heat decays after a quiet
  twelve seconds. A siren follows the nearest unit's distance.
- **Four linked jobs, Rookie to Kingpin.** Each has a brief, its own steps, a cash reward and a
  star rating, marked by a beacon you can read from across the street.
- **A HUD that answers everything at a glance.** Health, cash and five wanted stars top left;
  clock and weapon top right; the objective card top centre; a live 230-pixel minimap bottom
  right; a speedometer with gear bottom left; a context prompt and a mission banner.
- **All sound synthesised.** Engine hum, two-tone siren, a bassline that quickens with the heat,
  gunshots, punches, crashes, pickups, a mission fanfare, and the busted sting. No audio files.
- **Saves.** Pausing autosaves to local storage; the title screen offers CONTINUE when a save
  exists, and the game tolerates private mode where storage throws.

## Run it

No build step, nothing to install. Serve `game/` and open it in desktop Chrome:

```bash
node serve.ts
# http://127.0.0.1:8080
```

Or point any static server at `game/`. The page loads only files inside `game/` — Three.js is
vendored and reached through the page's import map.

Add `?seed=42` to the URL to rebuild a different city; the layout is deterministic for a seed.

## Controls

| Key | On foot | Driving |
| --- | --- | --- |
| `W` `A` `S` `D` / arrows | move | throttle, brake, steer |
| Mouse | look, aim | — |
| `Shift` | sprint | handbrake |
| `Space` | jump | — |
| `E` | take the nearest car | get out |
| Click | fire | horn |
| `F` | punch | — |
| `R` | reload | — |
| `1` / `2` | pistol / fists | — |
| `H` | — | horn |
| `P` or `Esc` | pause and save | pause and save |
| `M` | mute | mute |

## The four jobs

1. **First Wheels** — steal any car and bring it to the lock-up on Kestrel Row. *$450, ★*
2. **Payback** — a runner skipped a debt; wreck his sports car. *$800, ★★*
3. **Hot Package** — collect the case at the marina and run it to the north quay with the heat
   on. *$1,400, ★★*
4. **The Big Score** — lift the green sports car from the harbour deck, shake the tail until the
   wanted level is zero, and reach the hideout. *$2,600, ★★★*

## Screenshots

| | Frame | What it shows |
| --- | --- | --- |
| 1 | `screenshots/1-chase.jpg` | The cover: a red sports car mid-drift with two cruisers closing, three stars |
| 2 | `screenshots/2-onfoot.jpg` | On foot beside a damaged sedan, brake lights on, a beacon down the road |
| 3 | `screenshots/3-mission.jpg` | The marina case under its beacon, two cruisers with opposite bars |
| 4 | `screenshots/4-night.jpg` | A green sports car at night, headlights and beams, a cruiser behind |

All four are captured from this build by `tools/capture.mjs` at 1280 by 800 and checked by
`tools/verify.py`.

## Tools

```bash
node tools/probe.mjs                 # load the page, report errors and counts
node tools/capture.mjs <url> <out>   # screenshot a staged preset over the DevTools protocol
node tools/playtest.mjs              # drive the real game headlessly through fourteen steps
python3 tools/verify.py <shot.jpg>   # six checks on a staged frame
```

`capture.mjs` and `playtest.mjs` drive the Playwright Chromium binary with their own tiny
DevTools-protocol client over Node's built-in WebSocket, so no npm package is needed. Set
`CHROME_PATH` if the browser lives somewhere unusual.

## Handing it in

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` into the output
directory, prints each screenshot's size, and writes `dossier.json` with the kit's vendored
`buildDossier` library.

## Layout

```
main.ts                 entrypoint: copy, check, write the dossier
serve.ts                tiny static server for game/
shots.json              the four screenshot names and their queries
game/index.html         the only page: canvas, HUD, overlay, import map
game/src/               config random input audio world player vehicles
                        traffic police missions hud shots main
game/vendor/            Three.js, copied unchanged (MIT)
tools/                  capture, playtest, verify and small probes
screenshots/            the four frames
vendor/                 the kit's dossier builder, copied unchanged
```

## Licence

MIT. Three.js is vendored under `game/vendor/` with its own MIT licence. Everything else — the
city, the cars, the character, the story, the names, the art and the sound — was written for
this entry.
