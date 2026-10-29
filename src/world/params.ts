// The page's query, for looking at other days, times and weather while
// testing (?date=2027-01-15&time=21:30, sky.ts). The painter's worker has no
// query of its own: it is given the page's as its name (game/Painter.ts).
const inWorker = typeof window === 'undefined' && typeof self !== 'undefined' && 'name' in self;
const search = inWorker ? String((self as unknown as { name: string }).name) : typeof location === 'undefined' ? '' : location.search;

export const params = new URLSearchParams(search);
