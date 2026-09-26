/**
 * Small dependency-free math layer used by the simulation.
 * Keeping the physics free of Three.js means it can be unit-tested in plain Node
 * and guarantees the simulation is deterministic (no renderer state leaking in).
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export class Vec3 implements Vec3Like {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static from(v: Vec3Like): Vec3 {
    return new Vec3(v.x, v.y, v.z);
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3Like): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v: Vec3Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addScaled(v: Vec3Like, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  sub(v: Vec3Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  dot(v: Vec3Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vec3Like): this {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  horizontalLength(): number {
    return Math.sqrt(this.x * this.x + this.z * this.z);
  }

  normalize(): this {
    const len = this.length();
    if (len > 1e-9) this.scale(1 / len);
    return this;
  }

  setLength(len: number): this {
    return this.normalize().scale(len);
  }

  clampLength(max: number): this {
    const len = this.length();
    if (len > max && len > 1e-9) this.scale(max / len);
    return this;
  }

  lerp(v: Vec3Like, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  distanceTo(v: Vec3Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distanceToSq(v: Vec3Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  horizontalDistanceTo(v: Vec3Like): number {
    const dx = this.x - v.x;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z);
  }
}

export const TMP_A = new Vec3();
export const TMP_B = new Vec3();
export const TMP_C = new Vec3();

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  if (Math.abs(b - a) < 1e-9) return 0;
  return clamp01((v - a) / (b - a));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = invLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

/** Framerate independent exponential smoothing. */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  return lerp(current, target, 1 - Math.pow(smoothing, dt));
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

export function angleLerp(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function angleDelta(a: number, b: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function sign(v: number): number {
  return v < 0 ? -1 : 1;
}

/** Deterministic, seedable PRNG (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed = 0x1a2b3c4d) {
    this.state = seed >>> 0;
  }

  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Symmetric noise in [-amount, amount]. */
  noise(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.range(minInclusive, maxExclusive));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Rotate a horizontal vector (x,z) by yaw radians. */
export function rotateY(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = v.x * c + v.z * s;
  const z = -v.x * s + v.z * c;
  v.x = x;
  v.z = z;
  return v;
}

export function yawFromDirection(x: number, z: number): number {
  return Math.atan2(x, z);
}

export function dirFromYaw(yaw: number, out = new Vec3()): Vec3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}
