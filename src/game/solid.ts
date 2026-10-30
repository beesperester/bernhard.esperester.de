// What is solid: physical, opaque things that aren't foliage (furniture,
// follies, lanterns, the train, the coaster). Where one stands in front of
// your cat, the cat shows through it as a solid silhouette (game/Cards.ts);
// leaves, plants and other cats don't do that.

const SOLID = new WeakSet<object>();
/** ...and those of them standing on the ground, with a contact shadow round their foot (not the train, the coaster, a roof). */
const GROUNDED = new WeakSet<object>();

/** Mark `o` (a picture) as solid; `grounded`: it stands on the ground (its bottom row is its foot). */
export function solid<T extends object>(o: T, grounded = true): T {
  SOLID.add(o);
  if (grounded) GROUNDED.add(o);
  return o;
}

export function isGrounded(o: object): boolean {
  return GROUNDED.has(o);
}

export function isSolid(o: object): boolean {
  return SOLID.has(o);
}
