# bernhard.esperester.de

A tiny Game Boy Color–style garden. Every visitor is a cat.

- **Arrow keys** move · **Space** jump · **Shift** dash · **H** hiss · **R** roll on your back
- Idle cats sit down after a few seconds and lick their paws now and then; after 30 s they curl up and sleep (zzZZzz)
- Jump onto low obstacles — hedges, bushes, rocks, the fountain rim — and walk along them. Jump into the pond and you splash and scramble straight back out
- On touch devices an on-screen D-pad and buttons appear

## How it works

- **Phaser 4 + TypeScript + Vite**, built to static files.
- **All art is drawn in code** (`src/art/`): sprites are character maps, recoloured per coat; the garden ground is generated from `src/world/map.ts`.
- **Height map** (`src/world/map.ts`): every tile has a surface height; cats only move onto surfaces no higher than they are, so jumping (real gravity) gets them onto hedges. Tree trunks block only at their base.
- **Trees** (`src/game/Trees.ts`): big procedural crowns; a cat behind one is shown through a round dithered window in the foliage.
- **Atmosphere** (`src/game/`): `Meadow` sways ~600 grass/flower/reed sprites in a rolling wind and bends them away from cats; `Sunlight` overlays dithered god rays and dust motes; `PondReflection` mirrors nearby cats, trees and reeds onto the pond with a ripple; `Vignette` softly darkens the screen edges; `Ambient` adds butterflies, bees, jumping koi with ripples, sleep Zs and dash dust (local only, not synced).
- **Networking is peer-to-peer** (`src/net/net.ts`) via [Trystero](https://github.com/dmotz/trystero): visitors find each other through public Nostr relays, then exchange cat states directly over WebRTC. The web server only serves files.
- Each cat broadcasts `[x, y, z, facing, act, seq, coat]` ~10×/s while something changes (20×/s mid-jump), otherwise once per second.
- A garden holds 20 cats; later visitors are moved into `garden-2`, `garden-3`, …

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/
node tools/preview.ts /tmp/preview   # render sprite sheets & garden to PNG
```

## Deployment (all-inkl)

Upload the contents of `dist/` to the document root of `bernhard.esperester.de`. No PHP or database needed.
