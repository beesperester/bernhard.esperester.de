// Famous places of Berlin, as follies in the park: small models standing
// where the real ones are (tools/berlin/generate.ts places them, garden.ts
// lists where they ended up, art/landmarks.ts draws them).

export type LandmarkKind = 'tvtower' | 'gate' | 'reichstag' | 'victory' | 'dom' | 'rathaus' | 'church' | 'wall' | 'checkpoint' | 'oberbaum';

export interface LandmarkInfo {
  /** Its name, shown on a plaque when a cat comes by. */
  name: string;
  /** Where the real one is. */
  lat: number;
  lon: number;
}

export const LANDMARKS: Record<LandmarkKind, LandmarkInfo> = {
  tvtower: { name: 'Fernsehturm', lat: 52.5208, lon: 13.4094 },
  gate: { name: 'Brandenburger Tor', lat: 52.5163, lon: 13.3777 },
  reichstag: { name: 'Reichstag', lat: 52.5186, lon: 13.3762 },
  victory: { name: 'Siegessäule', lat: 52.5145, lon: 13.3501 },
  dom: { name: 'Berliner Dom', lat: 52.5191, lon: 13.4011 },
  rathaus: { name: 'Rotes Rathaus', lat: 52.5185, lon: 13.4083 },
  church: { name: 'Gedächtniskirche', lat: 52.5048, lon: 13.335 },
  wall: { name: 'East Side Gallery', lat: 52.505, lon: 13.4397 },
  checkpoint: { name: 'Checkpoint Charlie', lat: 52.5075, lon: 13.3904 },
  oberbaum: { name: 'Oberbaumbrücke', lat: 52.5019, lon: 13.4458 },
};

/** Tiles each one takes up, across and deep. */
export const LANDMARK_SIZE: Record<LandmarkKind, [number, number]> = {
  tvtower: [2, 2], gate: [4, 1], reichstag: [4, 2], victory: [2, 2], dom: [3, 2], rathaus: [3, 2],
  church: [2, 2], wall: [5, 1], checkpoint: [2, 1], oberbaum: [3, 1],
};

/**
 * How each one is drawn: the sprite's size, and where its top-left corner is
 * from the top-left of its tiles (px). Its foot is the bottom of its tiles.
 */
export const LANDMARK_SPRITE: Record<LandmarkKind, { w: number; h: number; ox: number; oy: number }> = {
  tvtower: { w: 32, h: 100, ox: 0, oy: -68 },
  // a little wider than its tiles, so that the arches let a cat through
  gate: { w: 88, h: 52, ox: -12, oy: -37 },
  reichstag: { w: 64, h: 54, ox: 0, oy: -22 },
  victory: { w: 32, h: 90, ox: 0, oy: -58 },
  dom: { w: 48, h: 62, ox: 0, oy: -30 },
  rathaus: { w: 48, h: 66, ox: 0, oy: -34 },
  church: { w: 32, h: 66, ox: 0, oy: -34 },
  wall: { w: 80, h: 26, ox: 0, oy: -11 },
  checkpoint: { w: 32, h: 38, ox: 0, oy: -23 },
  oberbaum: { w: 48, h: 42, ox: 0, oy: -27 },
};

/** Nothing gets over these (a tall folly). */
const TALL = 99;

/** The solid parts, from the top-left of its tiles (px): x0, y0, x1, y1, height. */
export const LANDMARK_SOLIDS: Record<LandmarkKind, [number, number, number, number, number][]> = {
  tvtower: [[3, 20, 29, 31, TALL]],
  // the six columns of the gate (see LANDMARK_SPRITE: they stand at 0, 16, 32, 52, 68 and 84 of the sprite)
  gate: [0, 16, 32, 52, 68, 84].map((x) => [x - 12, 7, x - 8, 14, TALL] as [number, number, number, number, number]),
  reichstag: [[1, 6, 63, 31, TALL]],
  victory: [[3, 16, 29, 31, TALL]],
  dom: [[1, 8, 47, 31, TALL]],
  rathaus: [[1, 6, 47, 31, TALL]],
  church: [[2, 8, 30, 31, TALL]],
  wall: [[0, 8, 80, 15, TALL]],
  checkpoint: [[2, 4, 30, 15, TALL]],
  oberbaum: [[0, 5, 48, 15, TALL]],
};

/** How deep each one is, front to back, for its sun shadow (px either side), or round. */
export const LANDMARK_DEPTH: Record<LandmarkKind, number | 'round'> = {
  tvtower: 'round', gate: 3, reichstag: 12, victory: 'round', dom: 11, rathaus: 12, church: 'round', wall: 3, checkpoint: 5, oberbaum: 4,
};
