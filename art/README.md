# The garden's art

Everything here is loaded by the game as it is. Save a file in Aseprite and the
dev server reloads the game with it (`tools/art-plugin.ts` reads the files; a
build packs them into one file the game fetches as it loads).

Files are RGBA (Sprite > Color Mode > RGB Color). Layers at the top level are
what the game reads, by name. A group counts as what's in it, as Aseprite
shows it (hidden layers are left out; use the Normal blend mode). Pixels that
are less than half covered are left out.

## Seasons

A file is its picture in summer (its first frame). The game works out the
other seasons from it, with the colours in the folder's `seasons.aseprite` (see
below). To paint a season yourself instead, add a frame and tag it `autumn`,
`winter` or `spring`; yours is shown then. Keep the shape the same all year,
because the game dithers from one season into the next as it turns:

| holds | turns to the next |
|---|---|
| summer: 10 May to 20 September | autumn by 15 October |
| autumn: 15 October to 1 November | winter by 25 November |
| winter: 25 November to 5 April | spring by 20 April |
| spring: 20 to 28 April | summer by 10 May |

Paint winter without snow. The game lays snow on top as much as is lying, along
the tops of what's painted and of boughs (a lit edge with shadow just above it).

## trees/

`<kind>-<s|m>.aseprite`: every tree of that kind and size in the park is this
one, every other one mirrored. The kinds are broadleaf, beech (a cooler green),
cherry, apple and pine.

Layers:

- `back`: the leaves behind the trunk
- `mid`: the trunk, branches and stumps, all of them, even where leaves hide them.
  In winter it's all there is of a leafy tree. It's also what a cat up the tree sees solid round it.
- `front`: the leaves hanging in front of the trunk and of a cat up the tree
- `normal`: which way it faces, as a normal map (red to the right, green up, blue towards you).
  It's optional and hidden, and read from the first frame. Where it's painted, the game lights the
  tree by it; elsewhere, and on a tree that's bare in winter, it works the normals out from the
  outline, as the exported layer shows.
- `guide`: where a cat can stand. It's read from the first frame that has it and is never shown.
  - red (255,0,0): branches
  - green (0,255,0): stumps up the trunk
  - The white mark at the trunk's foot is only a mark.

  A cat stands on a line's top edge, pixel for pixel, and never falls through
  it. Where a line is steeper than 35° for more than a 3 px rise, a cat can't
  walk up it and slides down. A shorter steep bit is walked up like a stair.

The trunk's foot is the bottom middle of the canvas. If you make the canvas
bigger, do it evenly on the left and right, and only at the top.

The guide's rules (`npm test` checks them, at x,y as Aseprite shows them):

- Something is painted under most of each line, within 4 px.
- There's a stump, and the lowest one is 8 to 13 px up the trunk: out of a kitten's jump, but in a young cat's.
- A cat can climb to the highest line, a jump at a time (13 px up at most).

### trees/seasons.aseprite

These are the colours the leaves (`back` and `front`) turn to in each season,
laid out as every folder's `seasons.aseprite` is (below), with a layer per kind.
In winter, every tree but the pine loses its leaves.

`node tools/art-trees.ts [kinds | seasons]` draws the trees (in summer) and the
seasons' colours fresh from code. A file that's already there is left alone,
and the fresh one goes next to it as `*.new.aseprite`.

## seasons.aseprite

A folder's `seasons.aseprite` has a layer named after each file it recolours
(in `trees/`, after each kind). There's a column per season (summer, autumn,
winter, spring); each swatch is 8 px square.

- **Rows 1 to 3** are ramps, light to dark.
  - In summer, row 1 is the leaves as painted. Each leaf pixel finds its tone
    there, by brightness, and takes the same tone from the season's ramp.
  - With more than one ramp, the leaves turn in soft clouds, mostly to the first ramp.
- **Row 4** is dots: little blossoms, apples or berries sprinkled over it.
- **An empty season** means it looks as it does in summer.
- Only colours near row 1's summer ramp change; the rest (stems, flowers, outlines) stay as painted.

## plants/

`<kind>.aseprite`, one layer `art`: the meadow's grass (`tuft`, `tall`), the
flowers (`flower0` to `flower5`), `cattail`, and the forest floor's `fern`,
`bracken`, `shrub`, `shrub-berries` and `bramble`. Paint them standing upright;
the game leans them in the wind itself (most at the top). Their size is the
canvas's, and they stand on its bottom middle.

## water/

`lily-pad-<0..3>` and `lily-flower-<0..3>`, one layer `art`, centred on the
canvas.

## woodland/

`log`, `stump`, `stone` and `boulder`, one layer `art`. They look the same all
year (snow is laid on them in winter). Keep the canvas sizes: where they stand
is anchored to them.

`node tools/art-plants.ts [plants | water]` draws plants/ and water/ fresh from
code, in the same way as the trees; woodland/ is drawn with the furniture (below).

## ground/

The park's ground, a tile (16 px) at a time. Season frames aren't read here:
the game dresses the ground for the seasons itself (straw-coloured lawns, fallen leaves, snow,
frozen ponds, flowers going over). It knows what to dress by its colours, and
takes a colour you've painted for the nearest one it knows, so keep new colours
near the old ones (a green for the grass, a blue for the water).

- `lawn`, `tall-grass`, `flowers`, `path`, `water`, `hedge` and `maze-hedge`:
  layer `fill`, a texture laid over the park, repeated. Paint it so it repeats
  without a seam (View > Tiled Mode). It can be any size.
  - `lawn` also has a hidden layer `tones`: the lawn's colours, dark to light,
    a pixel each along the top row. The game shifts the lawn along them in broad
    patches, lusher and drier, so it doesn't show repeating.
  - `water` also has `ripples`, rocked a pixel to the right and back.
- `path-edges`, `water-edges`, `hedge-edges` and `maze-hedge-edges`: layer
  `edges`, 16 pieces laid over the fill where it meets something else. They're
  4 x 4 tiles; piece m is at column m % 4, row m / 4 (rounded down), where m adds
  up the sides that border something else: 1 north, 2 east, 4 south, 8 west.
  So the top-left piece (0) is empty, and the bottom-right one (15) is a tile
  with something else all round. The hidden layer `under` is the fill, to paint
  against.
- `bush` and `rock`: layer `art`, one tile. The sun shades them as they curve:
  the three colours most of the inside is painted in, by how light they are,
  are its light, mid and dark. The other colours (the outline) stay as painted.

`node tools/art-ground.ts [names]` draws these fresh from code, as the others.

## furniture/, funfair/, follies/

One layer `art` each, unless said otherwise. They look the same all year: the
game lays snow on their tops in winter, and freezes the bird bath and the
pump's puddle. Keep the canvas sizes, because where each stands is anchored to
them (and what a cat can stand on is still worked out in code).

- `furniture/`: `bench`, `picnic`, `bistro`, `chair`, `birdbath`, `blanket`,
  `basket`, `pump`, `puddle` and `hotel`.
  - `box` has two layers: `back` (behind a cat sitting in it) and `front` (over it).
  - Three change with what's growing in them, a frame for each, tagged:
    `catnip` (bare, young, grown, flowering), `bed` (bare, young, grown) and
    `barrow` (empty, soil).
- `funfair/`: `tent`, `booth` and `pole`.
- `follies/<kind>`: rotunda, tower, colonnade, terrace, obelisk, catstatue,
  urn, pavilion, teahouse and lookout. Those with a roof have it in a second
  layer, `roof`, which is drawn over a cat up on the folly.

`node tools/art-furniture.ts [furniture | funfair | woodland | follies]` draws
these fresh from code, painted over as the game paints them.
