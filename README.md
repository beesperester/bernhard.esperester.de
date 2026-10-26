# bernhard.esperester.de

A tiny Game Boy Color–style garden. Every visitor is a cat.

- **Arrow keys** move · **Space** jump · **Shift** (hold) dash · **X** (hold) sneak · **C** catch · **H** hiss · **R** roll on your back
- Dash lasts while Shift is held (max 2.5 s); recovery takes as long as it was used, ×12 (a full dash needs 30 s, at least 2 s)
- Koi sometimes drift up near the surface, even close to the shore: stand next to one and press **C** to catch and eat it
- Butterflies resting on flowers (or fluttering low) can be caught too — sneak up and stop before pouncing; walking right at them or dashing startles them. Swiping at a bee gets you stung: hiss!
- Dashing through grass startles a burst of butterflies
- Birds drop in on the trees, sit in the crowns and sometimes flutter down to peck on the lawn. Walk up and they fly off. Hold **X** to crouch and creep closer: at about two cat lengths the bird spots you (**!**) and leaves a moment later, so freeze and pounce with **Shift** before it does (creeping on or a missed swipe scares it away)
- **Day and night follow the real sun over Berlin**: sunrise and sunset come at the actual times for today's date. The light warms at dawn and dusk, and at night the park turns deep blue. By day, everything standing up (cats, trees, bushes, rocks, hedges, fences, cliffs) catches a sunlit rim on the side facing the sun, so you can tell where it is. Lanterns along the paths light up at dusk, and stars and the moon (in its real phase) shine in the ponds
- After dark there are no butterflies or bees; fireflies drift over the long grass instead (catch them with **C**), birds sleep up in the trees, frogs sit at the water's edge (they hop back in if you come too close; catch and eat them like fish) and cats' eyes glow. Add `?time=21:30` to the URL to see another time of day, or `?speed=600` to run the day faster
- Only your own cat shows through trees (a see-through hole) and hills (a green silhouette); other cats are hidden behind them like anything else
- The browser tab's icon shows how many cats are in your garden right now (you included)
- Walking straight into an edge slides you into an opening just beside it (corner slip, as in the Zelda games), so the narrow gaps of the labyrinth are easy to enter
- Idle cats sit down after a few seconds and lick their paws now and then; after 30 s they curl up and sleep (zzZZzz)
- Jump onto low obstacles — hedges, bushes, rocks, the fountain rim — and walk along them. Jump into the pond and you splash and scramble straight back out
- The park (80×60 tiles): narrow winding paths, a two-level highland and a little mesa ringed by stone walls — drop off any edge, but you have to find the stairs to get up — a spring feeding a stream that runs under footbridges into the lake, small lily ponds, a walled rose garden, and a hedge labyrinth (too tall to jump) with a fountain at its heart
- Background music and sounds start with your first key press or tap; **M** / the ♪ button mutes the music, **S** / the speaker button the sounds; both pause while the tab is hidden. Birds sing now and then from a tree near you; cats boing when they jump, purr when content, hiss, whoosh off when dashing, patter along paths (lower on the wooden bridges, brighter on stone stairs), rustle through tall grass and chew their catch, and the water splashes — for every cat near you
- On touch devices an on-screen D-pad and buttons appear

## How it works

- **Phaser 4 + TypeScript + Vite**, built to static files.
- **All art is drawn in code** (`src/art/`): sprites are character maps, recoloured per coat; the garden ground is generated from `src/world/map.ts`.
- **Height map** (`src/world/map.ts`): every tile has a terrain level (16px each, more than a jump) plus whatever stands on it; cats only move onto surfaces no higher than they are, so jumping (real gravity) gets them onto hedges but not up a cliff. Walking climbs up to 3px, which is what makes stairs work. Tree trunks block only at their base.
- **Terrain** (`src/art/terrain.ts`): each row of raised ground is cut from the ground image and drawn lifted by its height, with a stone retaining wall below and depth-sorted like everything else; a cat that ends up behind a hill shows through as a solid green silhouette where the hill covers it.
- **Trees** (`src/game/Trees.ts`): big procedural crowns; a cat behind one is shown through a round dithered window in the foliage.
- **Atmosphere** (`src/game/`): `Meadow` sways ~600 grass/flower/reed sprites in a rolling wind and bends them away from cats; `Sunlight` overlays dithered god rays that breathe and dim under passing clouds, plus dust motes; `Clouds` drifts soft dithered cloud shadows across the ground; `PondReflection` mirrors nearby cats, trees and reeds onto the water with a ripple (split into chunks, only those on screen are redrawn); `Vignette` softly darkens the screen edges; `Ambient` adds butterflies, bees, jumping and surfacing koi with ripples, sleep Zs and dash dust; `Birds` handles the birds visiting the trees and lawns.
- **Networking is peer-to-peer** (`src/net/net.ts`) via [Trystero](https://github.com/dmotz/trystero): visitors find each other through public Nostr relays, then exchange cat states directly over WebRTC. The web server only serves files.
- **Fauna and clouds are synced without traffic**: peers agree on a shared garden clock (a few request/response pings to the lowest peer id), and every butterfly, bee, bird, fish and cloud is a pure function of that clock and a seed. The only fauna message is "fish/butterfly/bee/bird N was caught"; birds and butterflies taking flight are worked out from the (synced) cat states.
- Each cat broadcasts `[x, y, z, facing, act, seq, coat]` ~10×/s while something changes (20×/s mid-jump), otherwise once per second.
- A garden holds 20 cats; later visitors are moved into `garden-2`, `garden-3`, …

## Music

Every `.mp3`/`.ogg`/`.m4a` in `src/music/` is part of the playlist (the file name is the title). Songs play in random order, never the same one twice in a row; with a single song it loops. Convert masters before adding them, e.g.

```sh
ffmpeg -i "Song.wav" -c:a libmp3lame -q:a 2 "src/music/Song.mp3"
```

## Sounds

Every folder in `src/sounds/` is a sound group (`birds`, `purr`, `hiss`, `dash`, `splash`, `eat`, `rustle`, `steps`, `jump`; later e.g. `wind`), and each play picks one of its files at random (never the same twice in a row). Groups play on Web Audio, so any number overlap.

- **Ambient layers** (`LAYERS` in `src/audio/sound.ts`) fire on their own at random intervals with random volume and pitch, e.g. `birds: { every: [12, 40], volume: [0.35, 0.6], rate: [0.94, 1.08] }`. The scene can say where they come from (`sound.setSource('birds', …)` picks a tree near you).
- **Game sounds**: `sound.play('hiss', { at: { x, y } })` — sounds placed in the park fade with distance from your cat and pan left/right. `loop: true` returns a handle to `stop()` or `setVolume()` later (for wind or purring).

- **Cat sounds** (`src/game/CatSounds.ts`) are worked out from the synced cat state, so they play for other cats too.

Short effects are best as mono MP3, peak-normalised to -3 dB so the volumes in code are comparable (here for a file peaking at -12 dB):

```sh
ffmpeg -i "birds.wav" -ac 1 -af volume=9dB -c:a libmp3lame -q:a 3 src/sounds/birds/birds-2.mp3
```

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/
node tools/preview.ts /tmp/preview   # render sprite sheets & garden to PNG
```

## Deployment

GitHub Pages: every push to `main` builds the site and publishes `dist/` (`.github/workflows/pages.yml`), served at https://bernhard.esperester.de. The domain points at GitHub with a DNS record at all-inkl: `bernhard` → CNAME → `beesperester.github.io`. No server-side code is needed; the cats talk to each other directly.
