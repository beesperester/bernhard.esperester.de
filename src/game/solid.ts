// What is solid: physical, opaque things that aren't foliage (furniture,
// follies, lanterns, the train, the coaster). Where one stands in front of
// your cat, the cat shows through it as a solid silhouette (game/Cards.ts);
// leaves, plants and other cats don't do that.

const SOLID = new WeakSet<object>();

/** Mark `o` (a picture) as solid. */
export function solid<T extends object>(o: T): T {
  SOLID.add(o);
  return o;
}

export function isSolid(o: object): boolean {
  return SOLID.has(o);
}
