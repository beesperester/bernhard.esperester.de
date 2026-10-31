/// <reference types="vite/client" />

/** Injected by vite.config.ts at build time. */
declare const __BUILD__: string;
declare const __BUILD_YEAR__: number;

declare module 'virtual:art' {
  const art: {
    files: Record<string, { w: number; h: number; frames: number; tags: [string, number, number][]; layers: { name: string; at: number[] }[] }>;
    palette: string;
    /** The pixels inline (dev server, tests)... */
    pixels?: string;
    /** ...or a file to fetch (a build). */
    url?: string;
  };
  export default art;
}
