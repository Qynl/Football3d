/**
 * Collider descriptions for the arcade physics world.
 * Everything is analytic (planes, vertical cylinders, horizontal bars) which keeps
 * the solver cheap, stable and fully deterministic.
 */

export type SurfaceKind = 'ground' | 'wall' | 'net' | 'post' | 'crossbar' | 'goalback';

export interface GroundSurface {
  y: number;
  /** Coulomb friction coefficient for ball contacts. */
  friction: number;
  restitution: number;
  /** Extra rolling resistance (m/s^2) applied to grounded balls. */
  rollingResistance: number;
}

/** Axis aligned vertical wall plane, colliding from one side only. */
export interface WallCollider {
  /** Which axis the plane normal lies on. */
  axis: 'x' | 'z';
  /** Plane position along `axis`. */
  coord: number;
  /** +1 if the surface normal points towards +axis. */
  normalSign: number;
  /** Extent along the other horizontal axis. */
  min: number;
  max: number;
  /** Wall top; ball flying above this passes over it. */
  height: number;
  /** Wall bottom (used for goal-mouth gaps under the crossbar). */
  bottom: number;
  restitution: number;
  friction: number;
  kind: SurfaceKind;
  /** Nets damp the ball hard instead of bouncing it. */
  damping?: number;
}

/** Vertical cylinder: goal posts. */
export interface PostCollider {
  x: number;
  z: number;
  radius: number;
  yMin: number;
  yMax: number;
  restitution: number;
  kind: 'post';
}

/** Horizontal cylinder: crossbars. */
export interface BarCollider {
  /** Axis the bar runs along. */
  axis: 'x' | 'z';
  /** Bar extent along `axis`. */
  min: number;
  max: number;
  /** Position on the other horizontal axis. */
  other: number;
  y: number;
  radius: number;
  restitution: number;
  kind: 'crossbar';
}

export interface ContactEvent {
  kind: SurfaceKind | 'player';
  /** Impact speed along the contact normal (m/s). */
  impact: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** For player contacts. */
  playerIndex?: number;
}

export interface PhysicsMaterial {
  gravity: number;
  /** Quadratic air drag coefficient (a = -k * |v| * v). */
  airDrag: number;
  /** Magnus lift coefficient (a = k * (w x v)). */
  magnus: number;
  /** Per second spin decay factor in air. */
  spinDecay: number;
  /** Maximum ball speed clamp. */
  maxBallSpeed: number;
}

export const DEFAULT_MATERIAL: PhysicsMaterial = {
  gravity: -20.5,
  airDrag: 0.0062,
  magnus: 0.0055,
  spinDecay: 0.55,
  maxBallSpeed: 58,
};
