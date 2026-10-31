// The art drawn as files (art/**/*.aseprite) brought into the game as it's
// served or built: `import ART from 'virtual:art'` (read by src/art/files.ts).
// Each file's layers at the top (a group as what's in it, as Aseprite shows
// it), every frame, and its tags; the pixels in one palette, each a 16-bit
// number (0 nothing), deflated. Saving a file reloads the game.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Plugin } from 'vite';
import { readAseprite } from './aseprite.ts';

const ID = 'virtual:art', RESOLVED = '\0virtual:art';

function files(dir: string): string[] {
  let out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(files(p));
    else if (n.endsWith('.aseprite')) out.push(p);
  }
  return out.sort();
}

export interface PackedFile {
  w: number;
  h: number;
  frames: number;
  /** [name, from frame, to frame] */
  tags: [string, number, number][];
  /** The layers at the top, bottom first: their names, and where each frame's picture starts in the pixels (-1: nothing there). */
  layers: { name: string; at: number[] }[];
}

/** Every file in dir (its path from dir, without .aseprite), packed. */
export function packArt(dir: string): { files: Record<string, PackedFile>; palette: string; pixels: Buffer; read: string[] } {
  const palette = new Map<number, number>(), parts: Uint16Array[] = [], out: Record<string, PackedFile> = {};
  let at = 0;
  const read = files(dir);
  for (const path of read) {
    const ase = readAseprite(readFileSync(path));
    const { w, h } = ase;
    const layers = ase.layers.filter((l) => l.level === 0).map((l) => ({
      name: l.name.trim().toLowerCase(),
      at: l.frames.map((px) => {
        if (!px) return -1;
        const cel = new Uint16Array(w * h);
        let any = false;
        for (let k = 0; k < w * h; k++) {
          // (fully see-through left out; half see-through counts where it's at least half covered)
          if (px[k * 4 + 3] < 128) continue;
          const c = (px[k * 4] << 16) | (px[k * 4 + 1] << 8) | px[k * 4 + 2];
          if (!palette.has(c)) palette.set(c, palette.size + 1);
          cel[k] = palette.get(c)!;
          any = true;
        }
        if (!any) return -1;
        parts.push(cel);
        const start = at;
        at += cel.length;
        return start;
      }),
    }));
    if (palette.size > 65535) throw new Error(`art/: ${palette.size} colours, too many`);
    out[relative(dir, path).replace(/\\/g, '/').replace(/\.aseprite$/, '')] = { w, h, frames: ase.frames, tags: ase.tags.map((t) => [t.name.trim().toLowerCase(), t.from, t.to]), layers };
  }
  const joined = new Uint16Array(at);
  at = 0;
  for (const p of parts) { joined.set(p, at); at += p.length; }
  return {
    files: out,
    palette: [...palette.keys()].map((c) => c.toString(16).padStart(6, '0')).join(''),
    pixels: deflateSync(Buffer.from(joined.buffer), { level: 9 }),
    read,
  };
}

/** The plugin: in the dev server and tests the pixels come inline; in a build, as a file of their own fetched as the game loads. */
export function art(dir = 'art'): Plugin {
  let build = false;
  return {
    name: 'art',
    configResolved(c) { build = c.command === 'build'; },
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const { files, palette, pixels, read } = packArt(dir);
      for (const f of read) this.addWatchFile(resolve(f));
      const head = `export default { files: ${JSON.stringify(files)}, palette: '${palette}', `;
      if (!build) return `${head}pixels: '${pixels.toString('base64')}' };`;
      const ref = this.emitFile({ type: 'asset', name: 'art.bin', source: pixels });
      return `${head}url: import.meta.ROLLUP_FILE_URL_${ref} };`;
    },
    configureServer(server) {
      // (a file added or taken away: the game again, with it or without)
      server.watcher.add(dir);
      const changed = (path: string) => {
        if (!path.endsWith('.aseprite')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      for (const e of ['add', 'unlink', 'change'] as const) server.watcher.on(e, changed);
    },
  };
}
