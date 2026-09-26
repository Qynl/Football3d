import { clamp, clamp01 } from '../core/math.ts';

/**
 * Observes the human player's habits during a match and lets the AI adjust.
 * Everything here is derived from events the AI could legitimately "see".
 */
export class Adaptation {
  /** Exponentially decayed counters. */
  private shots = 0;
  private longShots = 0;
  private slides = 0;
  private wallRebounds = 0;
  private lobs = 0;
  private aerials = 0;
  private sideBias = 0;
  private dribbleTime = 0;
  private samples = 0;

  reset(): void {
    this.shots = this.longShots = this.slides = this.wallRebounds = 0;
    this.lobs = this.aerials = this.sideBias = this.dribbleTime = this.samples = 0;
  }

  decay(dt: number): void {
    const k = Math.exp(-dt / 22);
    this.shots *= k;
    this.longShots *= k;
    this.slides *= k;
    this.wallRebounds *= k;
    this.lobs *= k;
    this.aerials *= k;
    this.dribbleTime *= k;
    this.sideBias *= Math.exp(-dt / 30);
  }

  observeShot(distance: number, lob: boolean, airborne: boolean): void {
    this.shots += 1;
    if (distance > 11) this.longShots += 1;
    if (lob) this.lobs += 1;
    if (airborne) this.aerials += 1;
  }

  observeSlide(): void {
    this.slides += 1;
  }

  observeWallRebound(): void {
    this.wallRebounds += 1;
  }

  observePosition(x: number, halfWidth: number, dt: number): void {
    this.sideBias += (clamp(x / halfWidth, -1, 1) - this.sideBias) * Math.min(1, dt * 0.35);
    this.samples++;
  }

  observeDribble(dt: number): void {
    this.dribbleTime += dt;
  }

  /** 0..1 - how eagerly the AI should close down shooting space. */
  get pressBias(): number {
    return clamp01(this.longShots / 4);
  }

  /** 0..1 - how much the AI should avoid being in slide range. */
  get slideAvoidance(): number {
    return clamp01(this.slides / 5);
  }

  /** 0..1 - how much the AI should respect wall rebounds. */
  get wallAwareness(): number {
    return clamp01(this.wallRebounds / 3);
  }

  /** 0..1 - how much the AI should watch for chips over the top. */
  get aerialAwareness(): number {
    return clamp01((this.lobs + this.aerials) / 4);
  }

  /** -1..1 preferred attacking side of the human. */
  get preferredSide(): number {
    return this.sideBias;
  }

  summary(): string {
    const bits: string[] = [];
    if (this.pressBias > 0.35) bits.push('shoots early');
    if (this.slideAvoidance > 0.35) bits.push('slides a lot');
    if (this.wallAwareness > 0.35) bits.push('uses walls');
    if (this.aerialAwareness > 0.35) bits.push('goes aerial');
    if (Math.abs(this.preferredSide) > 0.4) bits.push(this.preferredSide > 0 ? 'right side' : 'left side');
    return bits.length ? bits.join(', ') : 'reading you...';
  }
}
