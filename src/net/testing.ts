// For tests: a stand-in for drand (any beacon with this signature passes), and a chain store in memory.
import { beacons, roundAt, type Beacon } from './beacon.ts';
import type { Block, ChainStore, Check } from './ledger.ts';
import type { Signed } from './identity.ts';
import type { Stamp } from './stamp.ts';

export const TEST_SIG = 'A'.repeat(64);
beacons.verify = async (x: Beacon) => x.b === TEST_SIG;

/** The beacon out right now (by the clock, which tests may move). */
export const testBeacon = async (): Promise<Beacon> => ({ r: roundAt(Date.now()), b: TEST_SIG });

export const memory = (): ChainStore & { blocks: Map<number, Block> } => {
  const blocks = new Map<number, Block>();
  let checks: Signed<Check>[] = [];
  let stamps: Stamp[] = [];
  return {
    blocks,
    load: async () => ({ blocks: [...blocks.values()], checks, stamps }),
    put: async (b) => void blocks.set(b.d.n, b),
    putChecks: async (c) => void (checks = c),
    putStamps: async (s) => void (stamps = s),
  };
};
