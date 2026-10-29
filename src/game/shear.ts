// Phaser draws a picture turned and stretched, but not sheared. Any 2x2
// matrix is a turn, a stretch and another turn, though; and a turned,
// stretched container holding a turned picture is exactly that.

/**
 * Matrix [[a, b], [c, d]] (x' = a x + b y, y' = c x + d y) as R(phi) S(sx, sy) R(theta): turn by
 * theta, stretch by sx and sy (sy < 0 if it mirrors), turn by phi.
 */
export function turnStretchTurn(a: number, b: number, c: number, d: number): { phi: number; sx: number; sy: number; theta: number } {
  const e = (a + d) / 2, f = (a - d) / 2, g = (c + b) / 2, h = (c - b) / 2;
  const q = Math.hypot(e, h), r = Math.hypot(f, g);
  const a1 = Math.atan2(g, f), a2 = Math.atan2(h, e);
  return { phi: (a2 + a1) / 2, sx: q + r, sy: q - r, theta: (a2 - a1) / 2 };
}
