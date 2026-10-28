// Where our chain of catches is kept between visits: IndexedDB, next to the key
// (identity.ts), one record per block, and the co-signatures and stamps in one more each.
import { open } from './identity.ts';
import type { Block, Chain, ChainStore, Check } from './ledger.ts';
import type { Signed } from './identity.ts';
import type { Stamp } from './stamp.ts';

function run<T>(name: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(name, mode);
          const req = f(tx.objectStore(name));
          tx.oncomplete = () => resolve(req ? req.result : null);
          tx.onerror = tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export const idbChainStore: ChainStore = {
  async load() {
    const blocks = ((await run<Block[]>('chain', 'readonly', (s) => s.getAll())) ?? []) as Block[];
    const checks = ((await run<Signed<Check>[]>('checks', 'readonly', (s) => s.get('all'))) ?? []) as Signed<Check>[];
    const stamps = ((await run<Stamp[]>('checks', 'readonly', (s) => s.get('stamps'))) ?? []) as Stamp[];
    return { blocks, checks: Array.isArray(checks) ? checks : [], stamps: Array.isArray(stamps) ? stamps : [] };
  },
  async put(b) {
    await run('chain', 'readwrite', (s) => void s.put(b, b.d.n));
  },
  async putChecks(checks) {
    await run('checks', 'readwrite', (s) => void s.put(checks, 'all'));
  },
  async putStamps(stamps) {
    await run('checks', 'readwrite', (s) => void s.put(stamps, 'stamps'));
  },
};

/** Put another chain in place of ours (wearing a collar tag): all of it, or nothing. */
export async function replaceChain(blocks: Block[], checks: Signed<Check>[], stamps: Stamp[]): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['chain', 'checks'], 'readwrite');
      const chain = tx.objectStore('chain');
      chain.clear();
      for (const b of blocks) chain.put(b, b.d.n);
      tx.objectStore('checks').put(checks, 'all');
      tx.objectStore('checks').put(stamps, 'stamps');
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Forget our chain (a new key: a new cat, starting over). */
export const clearChain = (): Promise<boolean> => replaceChain([], [], []);

/** Our chain, read back before the garden opens (main.ts). */
let current: Chain | null = null;
export const useChain = (c: Chain): void => {
  current = c;
};
export const theChain = (): Chain => {
  if (!current) throw new Error('chain not loaded yet');
  return current;
};
