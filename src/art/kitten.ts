// A kitten: the cat's frames (cat.ts) redrawn small, with a big head on a
// little body and short legs. Same letters as the cat (so the coats work the
// same), each frame drawn bottom-centred in the cat's 16×16 cell.

/** Pad rows into a 16×16 cell: feet on the bottom row, centred. */
function cell(rows: string[], shift = 0): string[] {
  const w = Math.max(...rows.map((r) => r.length));
  const left = Math.floor((16 - w) / 2) + shift;
  const body = rows.map((r) => ('.'.repeat(left) + r.padEnd(w, '.')).padEnd(16, '.').slice(0, 16));
  return [...Array.from({ length: 16 - rows.length }, () => '.'.repeat(16)), ...body];
}

/** Return a copy of rows with characters overwritten at (x, y) (in the rows as drawn here). */
function patch(rows: string[], edits: [number, number, string][]): string[] {
  const out = rows.map((r) => [...r]);
  for (const [x, y, s] of edits) for (let i = 0; i < s.length; i++) out[y][x + i] = s[i];
  return out.map((r) => r.join(''));
}

// ---- front (facing down) ----
const downStand = [
  '.o.....o.',
  'opo...opo',
  'obbooobbo',
  'obdbbbdbo',
  'obebbbebo',
  'obebbbebo',
  'owwbpbwwo',
  '.owwwwwo.',
  '.obwowbo.',
  '.oo...oo.',
];
const downWalk1 = patch(downStand, [[1, 8, 'obwobbo'], [1, 9, 'oo..oo.']]);
const downWalk2 = patch(downStand, [[1, 8, 'obbowbo'], [1, 9, '.oo..oo']]);

// ---- back (facing up) ----
const upStand = [
  '.o.....o..',
  'obo...obo.',
  'obbooobbo.',
  'obdbbbdbo.',
  'obbbbbbbo.',
  'obbbbbbbo.',
  'obbbbbbboo',
  '.obbbbbobo',
  '.obbobbo..',
  '.oo...oo..',
];
const upWalk1 = patch(upStand, [[1, 8, 'obbobbo'], [1, 9, 'oo..oo.']]);
const upWalk2 = patch(upStand, [[1, 8, 'obbobbo'], [1, 9, '.oo..oo']]);

// ---- side (facing left; flipped for right): the big head turned to us, a little body, the tail up ----
const sideStand = [
  '.o.....o.....',
  'opo...opo..o.',
  'obbooobbo.obo',
  'obdbdbdbo.obo',
  'obebbbeboooo.',
  'obebbbebbbbbo',
  'owwbpbwwbbbbo',
  '.owwwwwobbbbo',
  '..obwoobwobwo',
  '..ooo.ooo.oo.',
];
const sideWalk1 = [
  '.o.....o.....',
  'opo...opo..o.',
  'obbooobbo.obo',
  'obdbdbdbo.obo',
  'obebbbeboooo.',
  'obebbbebbbbbo',
  'owwbpbwwbbbbo',
  '.owwwwwobbbbo',
  '.obwo.obwobwo',
  '.ooo..ooo.oo.',
];
const sideWalk2 = [
  '.o.....o.....',
  'opo...opo..o.',
  'obbooobbo.obo',
  'obdbdbdbo.obo',
  'obebbbeboooo.',
  'obebbbebbbbbo',
  'owwbpbwwbbbbo',
  '.owwwwwobbbbo',
  '...obwobwobwo',
  '...oooooooo..',
];

// ---- sitting ----
const sitDown = [
  '.o.....o.',
  'opo...opo',
  'obbooobbo',
  'obdbbbdbo',
  'obebbbebo',
  'obebbbebo',
  'owwbpbwwo',
  '.owwwwwo.',
  'obwwwwwbo',
  'oooooooooddo',
];
const sitSide = [
  '.o.....o.....',
  'opo...opo....',
  'obbooobbo....',
  'obdbdbdbo....',
  'obebbbeboo...',
  'obebbbebbbo..',
  'owwbpbwwbdbo.',
  '.owwwwwobbbo.',
  '..owowwobbboo',
  '.oooooooooddo',
];

// ---- licking a paw ----
const lickDown1 = patch(sitDown, [[3, 6, 'brb'], [3, 7, 'oww']]);
const lickDown2 = patch(sitDown, [[3, 6, 'bpb'], [2, 7, 'owwo']]);
const lickSide1 = [
  '.o.....o.....',
  'opo...opo....',
  'obbooobbo....',
  'obdbdbdbo....',
  'obbbbbeboo...',
  'obobbbebbbo..',
  'owwopbwwbdbo.',
  'owwowwwobbbo.',
  '.oowowwobbboo',
  '.oooooooooddo',
];
const lickSide2 = [
  '.o.....o.....',
  'opo...opo....',
  'obbooobbo....',
  'obdbdbdbo....',
  'obbbbbeboo...',
  'obobbbebbbo..',
  'owworbwwbdbo.',
  'owwowwwobbbo.',
  '.oowowwobbboo',
  '.oooooooooddo',
];

// ---- hissing: mouth wide open, the tail puffed up ----
const hiss1 = [
  '..........o.oo',
  '.o.....o..obob',
  'opo...opo.obbo',
  'obbooobbo.obbo',
  'obdbdbdbo.obbo',
  'obebbbeboooobo',
  'obebbbebbbbbo.',
  'owwbpbwwbbbbo.',
  '.owrrrwobbbbo.',
  '..obwoobwobwo.',
  '..ooo.ooo.oo..',
];
const hiss2 = [
  '..........oo.o',
  '.o.....o..bobo',
  'opo...opo.obbo',
  'obbooobbo.obbo',
  'obdbdbdbo.obbo',
  'obebbbeboooobo',
  'obebbbebbbbbo.',
  'owwbpbwwbbbbo.',
  '.owrrrwobbbbo.',
  '..obwoobwobwo.',
  '..ooo.ooo.oo..',
];
const hissDown1 = patch(downStand, [[3, 6, 'brb']]);
const hissDown2 = patch(downStand, [[3, 6, 'brb'], [0, 0, 'oo'], [7, 0, 'oo']]);
const hissUp1 = patch(upStand, [[8, 5, 'oo'], [8, 4, 'obo']]);
const hissUp2 = upStand;

// ---- rolling on its back ----
const roll1 = [
  '.o.o.o.o...',
  'obobobobo.o',
  'owbwwwbbo.o',
  'oebwwwwbbob',
  'pbbdbwdbbo.',
  '.ooooooooo.',
];
const roll2 = [
  'o.o..o.o.',
  'obobobobo.o',
  'owwwwwwbo.o',
  'oebbbbbbboo',
  'pebbdbdbbo.',
  '.ooooooooo.',
];
const roll3 = roll1.map((r) => [...r.padEnd(11, '.')].reverse().join(''));

// ---- asleep, curled up ----
const sleep1 = [
  '.o.o......',
  'opoboooo..',
  'obbbbdbdbo',
  'oobobbbbbo',
  'pbbbwbbddo',
  '.ooooooooo',
];
const sleep2 = patch(sleep1, [[1, 3, 'bbbb']]);

// ---- catching: a paw out ----
const catch1 = [
  '..o.....o.....',
  '.opo...opo....',
  '.obbooobbo....',
  '.obdbdbdbo....',
  '.obebbbeboo...',
  '.obebbbebbbo..',
  '.owwbpbwwbdbo.',
  'owwwwwwwobbbo.',
  'oo.owowwobbboo',
  '..oooooooooddo',
];
const catch2 = [
  '..o.....o.....',
  '.opo...opo....',
  '.obbooobbo....',
  '.obdbdbdbo....',
  '.obebbbeboo...',
  '.obebbbebbbo..',
  '.owwbpbwwbdbo.',
  '..owwwwwobbbo.',
  'owwowowwobbboo',
  'oooooooooooddo',
];
const catchDown1 = patch(downStand, [[0, 7, 'oww'], [0, 8, 'oo']]);
const catchDown2 = patch(downStand, [[0, 8, 'owo']]);
const catchUp1 = patch(upStand, [[0, 8, 'oo']]);
const catchUp2 = upStand;
const chew = [
  '.o.....o.....',
  'opo...opo....',
  'obbooobbo....',
  'obdbdbdbo....',
  'obebbbeboo...',
  'obebbbebbbo..',
  'owwwrwwwbdbo.',
  '.owwrwwobbbo.',
  '..owowwobbboo',
  '.oooooooooddo',
];
const chewDown = patch(sitDown, [[3, 6, 'brb']]);

// ---- crouching and sneaking: belly to the ground ----
const sideCrouch = [
  '.o.....o......',
  'opo...opo.....',
  'obbooobbo.....',
  'obdbdbdbo.....',
  'obebbbeboooo..',
  'obebbbebbbbbo.',
  'owwbpbwwbbbbdo',
  'owwowwwobbbddo',
  '.oooooooooooo.',
];
const sideSneak1 = [
  '.o.....o......',
  'opo...opo.....',
  'obbooobbo.....',
  'obdbdbdbo.....',
  'obebbbeboooo..',
  'obebbbebbbbbo.',
  'owwbpbwwbbbbdo',
  'wwoowwwobbbddo',
  '.oooooooooooo.',
];
const sideSneak2 = [
  '.o.....o......',
  'opo...opo.....',
  'obbooobbo.....',
  'obdbdbdbo.....',
  'obebbbeboooo..',
  'obebbbebbbbbo.',
  'owwbpbwwbbbbdo',
  'owwwowwobbbddo',
  '.oooooooooooo.',
];
const downCrouch = [
  '.o.....o.',
  'opo...opo',
  'obbooobbo',
  'obdbbbdbo',
  'obebbbebo',
  'owebpbewo',
  'owwwwwwwo',
  '.ooooooo.',
];
const downSneak1 = patch(downCrouch, [[0, 7, 'owo']]);
const downSneak2 = patch(downCrouch, [[6, 7, 'owo']]);
const upCrouch = [
  '.o.....o..',
  'obo...obo.',
  'obbooobbo.',
  'obdbbbdbo.',
  'obbbbbbbbo',
  'obbbbbbbobo',
  'obbbbbbbo.o',
  '.ooooooo..',
];
const upSneak1 = patch(upCrouch, [[0, 7, 'obo']]);
const upSneak2 = patch(upCrouch, [[6, 7, 'obo']]);

/** Every kitten frame, by the cat's frame names, in the cat's 16×16 cells. */
export const KITTEN_FRAMES: Record<string, string[]> = Object.fromEntries(
  Object.entries({
    downStand, downWalk1, downWalk2,
    upStand, upWalk1, upWalk2,
    sideStand, sideWalk1, sideWalk2,
    sitDown, sitSide,
    lickDown1, lickDown2, lickSide1, lickSide2,
    hiss1, hiss2, hissDown1, hissDown2, hissUp1, hissUp2,
    roll1, roll2, roll3,
    sleep1, sleep2,
    catch1, catch2, catchDown1, catchDown2, catchUp1, catchUp2, chew, chewDown,
    sideCrouch, sideSneak1, sideSneak2,
    downCrouch, downSneak1, downSneak2,
    upCrouch, upSneak1, upSneak2,
  }).map(([name, rows]) => [name, cell(rows)]),
);

// ---- a young cat: the grown cat's frames with a few rows and columns of body taken out ----

// (side on, cutting would push its tail up against its head: those are drawn here)
const youngSideStand = [
  '..............',
  '..............',
  '............o.',
  '.o.....o...obo',
  'op.....po..obo',
  'obooooobo.obo.',
  'obbbdbbbo.obo.',
  'obebbbebooobo.',
  'obebbbebbdbdbo',
  'owwbpbwwbbbbbo',
  '.owwrwwobbbbbo',
  '..wwwwwbbbbbo.',
  '..obwoobwoobwo',
  '..ooo.ooo.ooo.',
];
const youngSideWalk1 = [
  '..............',
  '..............',
  '............o.',
  '.o.....o...obo',
  'op.....po..obo',
  'obooooobo.obo.',
  'obbbdbbbo.obo.',
  'obebbbebooobo.',
  'obebbbebbdbdbo',
  'owwbpbwwbbbbbo',
  '.owwrwwobbbbbo',
  '..wwwwwbbbbbo.',
  '.obwo.obwoobwo',
  '.ooo..ooo.ooo.',
];
const youngSideWalk2 = [
  '..............',
  '..............',
  '............o.',
  '.o.....o...obo',
  'op.....po..obo',
  'obooooobo.obo.',
  'obbbdbbbo.obo.',
  'obebbbebooobo.',
  'obebbbebbdbdbo',
  'owwbpbwwbbbbbo',
  '.owwrwwobbbbbo',
  '..wwwwwbbbbbo.',
  '...obwobwoobwo',
  '...oooooooooo.',
];
const youngSideCrouch = [
  '..............',
  '..............',
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obebbbeboooo..',
  'obebbbebbdbdo.',
  'owwbpbwwbbbbbo',
  '.owwrwwobbbddo',
  '..wwwwwbbbbbo.',
  '.obwoowwoobwo.',
  '.oooo.ooo.ooo.',
];
const youngSideSneak1 = [
  '..............',
  '..............',
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obebbbeboooo..',
  'obebbbebbdbdo.',
  'owwbpbwwbbbbbo',
  '.owwrwwobbbddo',
  '..wwwwwbbbbbo.',
  'obwo.owwoobwo.',
  'oooo.ooo.ooo..',
];
const youngSideSneak2 = [
  '..............',
  '..............',
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obebbbeboooo..',
  'obebbbebbdbdo.',
  'owwbpbwwbbbbbo',
  '.owwrwwobbbddo',
  '..wwwwwbbbbbo.',
  '..obwowwoobbwo',
  '..oooooooooo..',
];
const youngSitSide = [
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obebbbebo.....',
  'obebbbebooo...',
  'owwbpbwwbbbo..',
  '.owwrwwobdbbo.',
  '..wwwwwbbbdbo.',
  '..wwowwbbbbbo.',
  '..wwowwbbbbboo',
  '..oooooooodddo',
];
const youngLickSide1 = [
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obbbbbebo.....',
  'obobbbebooo...',
  'owwbpbwwbbbo..',
  '.oworwwobdbbo.',
  '.owowwwbbbdbo.',
  '..wwowwbbbbbo.',
  '..wwowwbbbbboo',
  '..oooooooodddo',
];
const youngLickSide2 = [
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obbbbbebo.....',
  'obobbbebooo...',
  'owwbpbwwbbbo..',
  '.oworwwobdbbo.',
  '.owowwwbbbdbo.',
  '..wwowwbbbbbo.',
  '..wwowwbbbbboo',
  '..oooooooodddo',
];
const youngChew = [
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obebbbebo.....',
  'obebbbebooo...',
  'owwbpbwwbbbo..',
  '.owwrwwobdbbo.',
  '..wwrwwbbbdbo.',
  '..wwowwbbbbbo.',
  '..wwowwbbbbboo',
  '..oooooooodddo',
];
const youngCatch1 = [
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obebbbebo.....',
  'obebbbebooo...',
  'owwbpbwwbbbo..',
  '.owwrwwobdbbo.',
  'owowwwwbbbdbo.',
  '..wwowwbbbbbo.',
  '..wwowwbbbbboo',
  '..oooooooodddo',
];
const youngCatch2 = [
  '..............',
  '..............',
  '.o.....o......',
  'op.....po.....',
  'obooooobo.....',
  'obbbdbbbo.....',
  'obebbbebo.....',
  'obebbbebooo...',
  'owwbpbwwbbbo..',
  '.owwrwwobdbbo.',
  '..wwwwwbbbdbo.',
  'owowowwbbbbbo.',
  'owowowwbbbbboo',
  'oooooooooodddo',
];
const youngHiss1 = [
  '..........oo.o',
  '..........obob',
  '..........obbo',
  '.o.....o..obbo',
  'op.....po.obbo',
  'obooooobo.obbo',
  'obbbdbbbo.obo.',
  'obebbbebooobo.',
  'obwpwbebbdbdbo',
  'oorrrowwbbbbbo',
  '.owwrwwobbbbbo',
  '..wwwwwbbbbbo.',
  '..obwoobwoobwo',
  '..ooo.ooo.ooo.',
];
const youngHiss2 = [
  '..........o.oo',
  '..........bobo',
  '..........obbo',
  '.o.....o..obbo',
  'op.....po.obbo',
  'obooooobo.obbo',
  'obbbdbbbo.obo.',
  'obebbbebooobo.',
  'obwpwbebbdbdbo',
  'oorrrowwbbbbbo',
  '.owwrwwobbbbbo',
  '..wwwwwbbbbbo.',
  '..obwoobwoobwo',
  '..ooo.ooo.ooo.',
];

/** Frames drawn for the young cat rather than cut down from the grown cat's. */
const YOUNG: Record<string, string[]> = {
  hiss1: youngHiss1,
  hiss2: youngHiss2,
  sitSide: youngSitSide,
  lickSide1: youngLickSide1,
  lickSide2: youngLickSide2,
  chew: youngChew,
  catch1: youngCatch1,
  catch2: youngCatch2,
  sideStand: youngSideStand,
  sideWalk1: youngSideWalk1,
  sideWalk2: youngSideWalk2,
  sideCrouch: youngSideCrouch,
  sideSneak1: youngSideSneak1,
  sideSneak2: youngSideSneak2,
};

/** Rows and columns (of the 16×16 frame) to take out, by family of frames, so they animate together. */
const CUTS: [RegExp, number[], number[]][] = [
  [/^(downCrouch|downSneak)/, [8], [5, 10]],
  [/^(upCrouch|upSneak)/, [8], [5, 10]],
  [/^hissUp/, [9, 10], [3, 12]],
  [/^(down|sitDown|lickDown|hissDown|catchDown|chewDown)/, [7, 12], [5, 10]],
  [/^(up|catchUp)/, [7, 12], [5, 10]],
  [/^roll/, [9], [8, 9]],
  [/^sleep/, [11], [9, 10]],
];

/** A young cat's frame, from the grown cat's (same name). */
export function youngFrame(name: string, rows: readonly string[]): string[] {
  if (YOUNG[name]) return cell(YOUNG[name]);
  const cut = CUTS.find(([re]) => re.test(name));
  const dropRows: number[] = cut?.[1] ?? [], dropCols: number[] = cut?.[2] ?? [];
  const kept = rows.filter((_, y) => !dropRows.includes(y)).map((r) => [...r].filter((_, x) => !dropCols.includes(x)).join(''));
  // back into a 16×16 cell, feet where they were (on the bottom row), centred
  const w = kept[0].length, left = Math.floor((16 - w) / 2);
  return [...Array.from({ length: 16 - kept.length }, () => '.'.repeat(16)), ...kept.map((r) => ('.'.repeat(left) + r).padEnd(16, '.'))];
}
