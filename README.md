# PORT MERIDIAN

An original 3D open-world crime game that runs in the browser, built for make.fun's **Make GTA 6** bounty.

[![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/metawo14/gta6-01/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/metawo14/gta6-01/reward.svg)](https://make.fun/c/gta6-01)

Port Meridian is a dusk-lit harbour city of neon, wet asphalt and dirty money. You land in the
docks with nothing, take a car that isn't yours, and work your way up from courier to kingpin
across four jobs while the Meridian Port Authority Police decide how much they care.

- Procedurally generated city: a 12×12 block grid of roads, lamps, hydrants, crates and a
  waterfront, laid out from a fixed seed so the city is always the same city.
- On foot and behind the wheel: WASD, sprint, jump, a third-person camera, five car classes,
  arcade drivetrain, drift, damage, smoke and screen shake.
- Traffic and pedestrians that keep to their lanes and pavements, cross at crossings and scatter
  when a car mounts the kerb.
- A five-star wanted level: police units spawn from the edges, ram and box you in, sirens and
  light bars included; get caught on foot and you are busted.
- Four linked missions with objectives, waypoints, banners and cash rewards.
- Handgun, fists, ammo and reload, muzzle flash and hit sparks.
- Full HUD: health, cash, stars, weapon, objective, speedometer, clock and a live minimap.
- Synthesised sound only: engine, siren, gunshots, crashes, pickups and a bassline. No audio files.

## Run it

There is no build step. Serve the `game/` folder from any static server and open it in desktop
Chrome:

```bash
node serve.ts                      # http://localhost:8080
# or
python3 -m http.server 8080 --directory game
# or
npx serve game
```

Everything the game loads is a file under `game/`; it makes no network requests.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Walk / drive |
| `Shift` | Sprint (on foot) / handbrake (driving) |
| `Space` | Jump / handbrake |
| `Mouse` | Orbit camera, aim |
| `Click` | Fire (pistol) |
| `E` | Enter / exit a vehicle |
| `F` | Punch |
| `R` | Reload |
| `P` / `Esc` | Pause, save, restart |
| `M` | Mute |
| `H` | Horn |
| `1` / `2` | Pistol / fists |

## Screenshot presets

`game/index.html?shot=chase|onfoot|mission|night` stages the game deterministically for capture.
When the staged frame is ready the page sets `window.__shotReady = true`.

## Entry

`main.ts` is the entrypoint: it copies `game/` and `screenshots/` into the output directory and
writes `dossier.json` with the kit's `vendor/makefun-game.ts` library. Outside the grader,
`MAKEFUN_OUTPUT_DIR` stands in for `/output`:

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Licence

MIT. See `LICENSE`. three.js is vendored under `game/vendor/` under its own MIT licence.
