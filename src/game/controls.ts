// The controls, Game Boy style: a D-pad and three buttons, the same on the
// keyboard and on a touch screen.
//
//   D-pad   walk; tap a direction twice quickly to dash that way
//   A       jump (↓ up a tree drops back down)
//   B       paw: a tap swipes (catch, splash for fish, paw at a tree or a
//           monument); held, the cat crouches and creeps; let go after
//           creeping with a direction held, it pounces that way
//   SELECT  a tap mews; held, ← hiss, ↑ mew, → roll
//
// What each button means from moment to moment is worked out here, free of
// Phaser, so it can be tested; the scene does the rest.

/** Two taps of a direction within this long make a dash. */
export const DOUBLE_TAP_MS = 260;
/** A button held this long is held, not tapped. */
export const HOLD_MS = 180;

/** Which way the D-pad points: some of 'u', 'd', 'l', 'r', or '' for none. */
export const dirOf = (up: boolean, down: boolean, left: boolean, right: boolean): string =>
  `${up ? 'u' : ''}${down ? 'd' : ''}${left ? 'l' : ''}${right ? 'r' : ''}`;

/** Spots a direction tapped twice: the cue for a dash. */
export class DoubleTap {
  private prev = '';
  private last = '';
  private lastAt = -Infinity;

  /** Call every frame with the D-pad's direction; true on the frame the second tap lands. */
  update(dir: string, now: number): boolean {
    const pressed = dir !== '' && dir !== this.prev;
    const fresh = this.prev === '';
    this.prev = dir;
    if (!pressed || !fresh) return false;
    if (dir === this.last && now - this.lastAt <= DOUBLE_TAP_MS) {
      this.last = '';
      return true;
    }
    this.last = dir;
    this.lastAt = now;
    return false;
  }
}

/** What the paw button did this frame. */
export interface PawEvents {
  /** A swipe now. */
  swipe: boolean;
  /** Crouched, creeping (while held). */
  low: boolean;
  /** Let go after creeping: pounce (or swipe, with the dash still resting). */
  pounce: boolean;
}

/** The paw button: tap to swipe, hold to creep, let go to pounce. */
export class Paw {
  private downAt = -1;
  /** This press has done its thing already (a swipe in mid-air). */
  private spent = false;

  /** `airborne`: in mid-jump a press swipes at once (there's no creeping in the air). */
  update(held: boolean, now: number, airborne: boolean): PawEvents {
    const out: PawEvents = { swipe: false, low: false, pounce: false };
    if (held && this.downAt < 0) {
      this.downAt = now;
      this.spent = airborne;
      out.swipe = airborne;
    } else if (!held && this.downAt >= 0) {
      if (!this.spent) {
        if (now - this.downAt >= HOLD_MS) out.pounce = true;
        else out.swipe = true;
      }
      this.downAt = -1;
    }
    out.low = held && !this.spent && this.downAt >= 0 && now - this.downAt >= HOLD_MS;
    return out;
  }
}

export type Emote = 'hiss' | 'mew' | 'roll';

/** The emote button: a tap mews; held, the D-pad picks one (← hiss, ↑ mew, → roll). */
export class Emotes {
  private downAt = -1;
  private chosen = false;
  private prev = '';

  /** `open`: the choice is showing (and the D-pad picks instead of walking). */
  update(held: boolean, dir: string, now: number): { emote: Emote | null; open: boolean; steering: boolean } {
    let emote: Emote | null = null;
    const pressed = dir !== '' && dir !== this.prev ? dir : '';
    this.prev = dir;
    if (held && this.downAt < 0) {
      this.downAt = now;
      this.chosen = false;
    }
    if (held && !this.chosen && pressed) {
      const pick: Emote | null = pressed.includes('l') ? 'hiss' : pressed.includes('r') ? 'roll' : pressed.includes('u') ? 'mew' : null;
      if (pick) {
        emote = pick;
        this.chosen = true;
      }
    }
    if (!held && this.downAt >= 0) {
      if (!this.chosen && now - this.downAt < HOLD_MS) emote = 'mew';
      this.downAt = -1;
    }
    const steering = held && this.downAt >= 0;
    return { emote, open: steering && !this.chosen && now - this.downAt >= HOLD_MS, steering };
  }
}
