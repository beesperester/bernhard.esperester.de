import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

const git = (cmd: string, fallback: string) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
};

// build number = commit count on the current branch, plus the short hash
const BUILD = `${git('rev-list --count HEAD', '0')} (${git('rev-parse --short HEAD', 'dev')})`;

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  define: {
    __BUILD__: JSON.stringify(BUILD),
    __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()),
  },
});
