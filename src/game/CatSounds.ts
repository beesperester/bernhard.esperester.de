import { sound, type Playing } from '../audio/sound.ts';
import { tileAt, TILE } from '../world/map.ts';
import { Act } from './state.ts';
import type { CatView } from './CatView.ts';

/** Content cats purr. */
const PURRING: ReadonlySet<Act> = new Set([Act.Sit, Act.Lick, Act.Sleep, Act.Roll]);
const DASH_ON = 120, DASH_OFF = 90;
/** Pitch of a footstep by surface: hollow wooden bridges lower, stone stairs brighter. */
const STEP_RATE: Record<string, number> = { p: 1, g: 1, B: 0.78, S: 1.18 };

interface State {
  act: Act;
  seq: number;
  actStart: number;
  dashing: boolean;
  nextRustle: number;
  nextStep: number;
  chews: number;
  purr: Promise<Playing | null> | null;
}

const vary = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Sounds cats make, for every cat in the garden (remote ones included), worked
 * out from the state that is synced anyway: purring while content, hissing,
 * a whoosh when dashing off, rustling through tall grass, chewing.
 */
export class CatSounds {
  private readonly cats = new Map<CatView, State>();

  update(cats: CatView[], now: number): void {
    for (const c of cats) {
      let s = this.cats.get(c);
      if (!s) this.cats.set(c, (s = { act: c.act, seq: c.seq, actStart: c.actStart, dashing: false, nextRustle: 0, nextStep: 0, chews: 0, purr: null }));
      const at = { x: c.x, y: c.y };
      const started = c.act !== s.act || c.seq !== s.seq || c.actStart !== s.actStart;
      const ms = now - c.actStart;

      if (started) {
        if (c.act === Act.Hiss) void sound.play('hiss', { at, volume: 0.7, rate: vary(0.93, 1.07) });
        if (c.act === Act.Mew) void sound.play('mew', { at, volume: 0.6, rate: vary(0.92, 1.1) });
        // a real jump bumps seq; just walking off a ledge doesn't
        if (c.act === Act.Jump && c.seq !== s.seq) void sound.play('jump', { at, volume: 0.35, rate: vary(0.95, 1.1) });
        if (c.act === Act.Munch) void sound.play('eat', { at, volume: 0.55, rate: vary(1.1, 1.25) });
        s.chews = 0;
      }
      // a fish or a bird takes a couple of bites
      if ((c.act === Act.Eat || c.act === Act.Feast) && ms >= s.chews * 1000 && s.chews < 2) {
        s.chews++;
        void sound.play('eat', { at, volume: 0.6, rate: vary(0.95, 1.05) });
      }

      // purring fades in while content and out when the cat gets up
      const content = PURRING.has(c.act);
      if (content && !s.purr) {
        const purr = (s.purr = sound.play('purr', { at, volume: c.act === Act.Sleep ? 0.3 : 0.4, loop: true, fade: 1.2 }));
        // muted, hidden or out of earshot: try again later
        void purr.then((p) => { if (!p && s.purr === purr) s.purr = null; });
      } else if (!content && s.purr) {
        void s.purr.then((p) => p?.stop(0.6));
        s.purr = null;
      }

      // whoosh when a cat bursts into a dash
      if (!s.dashing && c.speed > DASH_ON) {
        s.dashing = true;
        void sound.play('dash', { at, volume: 0.4, rate: vary(0.95, 1.1) });
      } else if (s.dashing && c.speed < DASH_OFF) s.dashing = false;

      const tile = tileAt(Math.floor(c.x / TILE), Math.floor((c.y - 2) / TILE));

      // pitter-patter on paths, bridges and stairs, and a pat when landing on them; barely a sound when sneaking
      const sneaking = c.act === Act.Sneak;
      const stepRate = STEP_RATE[tile];
      const landed = s.act === Act.Jump && c.act !== Act.Jump;
      if (stepRate && ((c.speed > 20 && c.act !== Act.Jump && now >= s.nextStep) || landed)) {
        s.nextStep = now + (s.dashing ? 115 : sneaking ? 400 : 245) + Math.random() * 30;
        void sound.play('steps', { at, volume: vary(0.18, 0.28) * (landed ? 1.4 : sneaking ? 0.3 : 1), rate: stepRate * vary(0.93, 1.07) });
      }

      // rustling through tall grass and flowers
      if (c.speed > 20 && c.act !== Act.Jump && (tile === ',' || tile === 'f') && now >= s.nextRustle) {
        s.nextRustle = now + (s.dashing ? 220 : sneaking ? 700 : 420) + Math.random() * 80;
        void sound.play('rustle', { at, volume: vary(0.25, 0.4) * (tile === 'f' ? 0.7 : 1) * (sneaking ? 0.35 : 1), rate: vary(0.88, 1.15) });
      }

      s.act = c.act;
      s.seq = c.seq;
      s.actStart = c.actStart;
    }
    // cats that left: stop their purring
    for (const [c, s] of this.cats)
      if (!cats.includes(c)) {
        void s.purr?.then((p) => p?.stop(0.3));
        this.cats.delete(c);
      }
  }
}
