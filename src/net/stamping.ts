// Keeping our chain stamped (stamp.ts): a stamp of its head every ten minutes of
// play and when the page goes away, and the pending ones completed once
// Bitcoin has caught up with them, so others can count our older catches.
import type { Chain } from './ledger.ts';
import { anchored, makeStamp, provenTime, upgradeStamp } from './stamp.ts';

/** How often our head gets stamped while we're catching things, and how often pending stamps are looked in on. */
const STAMP_EVERY_MS = 10 * 60 * 1000, UPGRADE_EVERY_MS = 30 * 60 * 1000;
const CHECK_MS = 60 * 1000;

export function startStamping(chain: Chain): void {
  let last = -Infinity;
  let busy = false;
  const stamp = async () => {
    if (busy || chain.stamped) return;
    busy = true;
    last = Date.now();
    try {
      const { n, h } = chain.head;
      const s = await makeStamp(chain.id, n, h);
      if (s) await chain.keepStamp(s);
    } finally {
      busy = false;
    }
  };
  /** Complete what can be completed, and see how far back we're proven. */
  const upgrade = async () => {
    for (const s of chain.stamps) {
      if (await anchored(chain.id, s)) continue;
      const up = await upgradeStamp(chain.id, s);
      if (up !== s) await chain.keepStamp(up);
    }
    for (const s of chain.stamps.reverse()) {
      if (!(await anchored(chain.id, s))) continue;
      const at = await provenTime(chain.id, s);
      if (at !== null) {
        chain.anchor = Math.max(chain.anchor, at);
        break;
      }
    }
  };
  // (anything left unstamped from last time first)
  void stamp().then(upgrade);
  setInterval(() => { if (Date.now() - last >= STAMP_EVERY_MS) void stamp(); }, CHECK_MS);
  setInterval(() => void upgrade(), UPGRADE_EVERY_MS);
  // leaving (or hidden, which on a phone may be the last we hear): stamp what we've got
  document.addEventListener('visibilitychange', () => { if (document.hidden) void stamp(); });
  window.addEventListener('pagehide', () => void stamp());
}
