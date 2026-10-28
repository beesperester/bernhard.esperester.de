import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, DoubleTap, Emotes, HOLD_MS, Paw } from './controls.ts';

describe('double tap', () => {
  it('dashes on a direction tapped twice quickly', () => {
    const t = new DoubleTap();
    expect(t.update('l', 0)).toBe(false);
    expect(t.update('', 80)).toBe(false);
    expect(t.update('l', 160)).toBe(true);
    // (and a third tap starts counting afresh)
    t.update('', 200);
    expect(t.update('l', 240)).toBe(false);
  });

  it('not when the taps are slow, in two directions, or one long press', () => {
    const t = new DoubleTap();
    t.update('l', 0);
    t.update('', 50);
    expect(t.update('l', DOUBLE_TAP_MS + 60)).toBe(false);
    t.update('', 400);
    expect(t.update('r', 420)).toBe(false);
    for (let ms = 420; ms < 1000; ms += 16) expect(t.update('r', ms)).toBe(false);
  });
});

describe('the paw button', () => {
  it('swipes on a tap', () => {
    const p = new Paw();
    expect(p.update(true, 0, false)).toEqual({ swipe: false, low: false, pounce: false });
    expect(p.update(false, 90, false)).toEqual({ swipe: true, low: false, pounce: false });
  });

  it('creeps while held, and pounces on letting go', () => {
    const p = new Paw();
    p.update(true, 0, false);
    expect(p.update(true, HOLD_MS + 10, false).low).toBe(true);
    expect(p.update(false, 900, false)).toEqual({ swipe: false, low: false, pounce: true });
  });

  it('swipes at once in mid-jump, and only once', () => {
    const p = new Paw();
    expect(p.update(true, 0, true).swipe).toBe(true);
    expect(p.update(true, 500, false).low).toBe(false);
    expect(p.update(false, 600, false)).toEqual({ swipe: false, low: false, pounce: false });
  });
});

describe('the emote button', () => {
  it('mews on a tap', () => {
    const e = new Emotes();
    e.update(true, '', 0);
    expect(e.update(false, '', 100).emote).toBe('mew');
  });

  it('opens the choice when held, and the D-pad picks', () => {
    const e = new Emotes();
    e.update(true, '', 0);
    expect(e.update(true, '', HOLD_MS + 5)).toEqual({ emote: null, open: true, steering: true });
    expect(e.update(true, 'l', 400).emote).toBe('hiss');
    expect(e.update(true, 'l', 450)).toEqual({ emote: null, open: false, steering: true });
    expect(e.update(false, '', 500).emote).toBeNull();
    e.update(true, '', 600);
    expect(e.update(true, 'r', 700).emote).toBe('roll');
  });

  it('does nothing when held and let go without a pick', () => {
    const e = new Emotes();
    e.update(true, '', 0);
    expect(e.update(false, '', 900).emote).toBeNull();
  });
});
