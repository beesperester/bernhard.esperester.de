# The garden's art

Everything here is loaded by the game as it is. Save a file in Aseprite and the
dev server reloads the game with it (`tools/art-plugin.ts` reads the files; a
build packs them into one file the game fetches as it loads).

Files are RGBA (Sprite > Color Mode > RGB Color). Layers at the top level are
what the game reads, by name. A group counts as what's in it, as Aseprite
shows it (hidden layers are left out; use the Normal blend mode). Pixels that
are less than half covered are left out.

## Seasons

A file has a frame for each season, tagged `summer`, `autumn`, `winter` and
`spring`, with summer first. The game shows the season's frame and dithers
into the next one as the season turns:

| holds | turns to the next |
|---|---|
| summer: 10 May to 20 September | autumn by 15 October |
| autumn: 15 October to 1 November | winter by 25 November |
| winter: 25 November to 5 April | spring by 20 April |
| spring: 20 to 28 April | summer by 10 May |

Paint winter without snow. The game lays snow on top as much as is lying, along
the tops of what's painted and of boughs (a lit edge with shadow just above it).
A file without tags shows its first frame all year.

## trees/

`<kind>-<s|m>.aseprite`: every tree of that kind and size in the park is this
one, every other one mirrored. The kinds are broadleaf, beech (a cooler green),
cherry, apple and pine.

Layers:

- `back`: the leaves behind the trunk
- `mid`: the trunk, branches and stumps, which is what a cat up the tree sees solid round it
- `front`: the leaves hanging in front of a cat up the tree
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

`node tools/art-trees.ts [kinds]` draws the trees fresh from code. A file
that's already there is left alone, and the fresh one goes next to it as
`*.new.aseprite`.
