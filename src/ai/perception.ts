import { Vec3 } from '../core/math.ts';
import type { BallBody } from '../physics/world.ts';
import type { ArenaDef } from '../arenas/arenaDefs.ts';

export interface BallSample {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Delayed perception buffer. The AI only ever sees the ball as it was
 * `reactionTime` seconds ago - it cannot react to something a human could not.
 */
export class DelayedPerception {
  private buffer: BallSample[] = [];
  private time = 0;
  private capacity = 90;

  reset(): void {
    this.buffer.length = 0;
    this.time = 0;
  }

  record(ball: BallBody, dt: number): void {
    this.time += dt;
    this.buffer.push({
      t: this.time,
      x: ball.position.x,
      y: ball.position.y,
      z: ball.position.z,
      vx: ball.velocity.x,
      vy: ball.velocity.y,
      vz: ball.velocity.z,
    });
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  /** Ball state as it appeared `delay` seconds ago. */
  sample(delay: number, out: BallSample): BallSample {
    const target = this.time - delay;
    if (this.buffer.length === 0) {
      out.t = 0;
      out.x = out.y = out.z = out.vx = out.vy = out.vz = 0;
      return out;
    }
    let chosen = this.buffer[0];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].t <= target) {
        chosen = this.buffer[i];
        break;
      }
    }
    Object.assign(out, chosen);
    return out;
  }
}

export interface TrajectoryPoint {
  t: number;
  x: number;
  y: number;
  z: number;
}

const GRAV = -20.5;

/**
 * Forward-simulates the ball (gravity, drag, ground + wall bounces).
 * Cheap on purpose: 20Hz samples, no spin. Good enough for interception,
 * imperfect enough to stay human-like.
 */
export function predictTrajectory(
  start: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  arena: ArenaDef,
  horizon: number,
  out: TrajectoryPoint[],
  radius = 0.36,
): TrajectoryPoint[] {
  out.length = 0;
  let x = start.x;
  let y = start.y;
  let z = start.z;
  let vx = start.vx;
  let vy = start.vy;
  let vz = start.vz;
  const dt = 1 / 20;
  const steps = Math.min(64, Math.ceil(horizon / dt));
  const hw = arena.halfWidth;
  const hl = arena.halfLength;
  for (let i = 0; i < steps; i++) {
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const drag = 0.0062 * sp;
    vx -= vx * drag * dt;
    vy -= vy * drag * dt;
    vz -= vz * drag * dt;
    vy += GRAV * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (y < radius) {
      y = radius;
      if (vy < 0) vy = -vy * arena.groundRestitution;
      const f = Math.max(0, 1 - arena.rollingResistance * dt * 0.35);
      vx *= f;
      vz *= f;
      if (Math.abs(vy) < 0.6) vy = 0;
    }
    if (Math.abs(x) > hw - radius && y < arena.wallHeight + radius) {
      x = Math.sign(x) * (hw - radius);
      vx = -vx * arena.wallRestitution;
    }
    const mouth = arena.goalWidth / 2;
    if (Math.abs(z) > hl - radius && (Math.abs(x) > mouth || y > arena.goalHeight)) {
      z = Math.sign(z) * (hl - radius);
      vz = -vz * arena.wallRestitution;
    }
    out.push({ t: (i + 1) * dt, x, y, z });
  }
  return out;
}

/**
 * Earliest trajectory point a runner can plausibly reach.
 * Uses a simple "can I cover the distance in time" test with acceleration slack.
 */
export function findInterception(
  traj: TrajectoryPoint[],
  from: Vec3,
  maxSpeed: number,
  reachRadius: number,
  startupPenalty = 0.22,
): { point: TrajectoryPoint; time: number } | null {
  for (const p of traj) {
    const dx = p.x - from.x;
    const dz = p.z - from.z;
    const dist = Math.hypot(dx, dz) - reachRadius;
    if (dist <= 0) return { point: p, time: p.t };
    const travelTime = dist / maxSpeed + startupPenalty;
    if (travelTime <= p.t && p.y < 2.6) return { point: p, time: p.t };
  }
  return null;
}

/** Where the ball will cross a given z plane (or null). */
export function crossingAt(traj: TrajectoryPoint[], z: number, towards: number): TrajectoryPoint | null {
  for (const p of traj) {
    if (towards > 0 ? p.z >= z : p.z <= z) return p;
  }
  return null;
}
