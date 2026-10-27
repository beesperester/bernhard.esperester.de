import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { existsSync, watch } from 'node:fs';

const git = (cmd: string, fallback: string) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
};

// build number = commit count on the current branch, plus the short hash
const BUILD = `${git('rev-list --count HEAD', '0')} (${git('rev-parse --short HEAD', 'dev')})`;

// the dev server reads the build number once, so restart it whenever HEAD moves (commit, checkout, merge)
const rebuildOnCommit = (): Plugin => ({
  name: 'rebuild-on-commit',
  apply: 'serve',
  configureServer(server) {
    const log = '.git/logs/HEAD';
    if (!existsSync(log) || process.env.VITEST) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = watch(log, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void server.restart(), 300);
    });
    server.httpServer?.on('close', () => watcher.close());
  },
});

export default defineConfig({
  base: './',
  plugins: [rebuildOnCommit()],
  build: { chunkSizeWarningLimit: 2000 },
  define: {
    __BUILD__: JSON.stringify(BUILD),
    __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()),
  },
});
