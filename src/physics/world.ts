import { Vec3, clamp } from '../core/math.ts';
import type {
  BarCollider,
  ContactEvent,
  GroundSurface,
  PhysicsMaterial,
  PostCollider,
  WallCollider,
} from './colliders.ts';
import { MATCH_BALL_RADIUS,
  DEFAULT_MATERIAL } from './colliders.ts';

/** Dynamic sphere = the football. */
export class BallBody {
  readonly position = new Vec3(0, 0.4, 0);
  readonly velocity = new Vec3();
  /** Angular velocity (rad/s). */
  readonly spin = new Vec3();
  readonly prevPosition = new Vec3(0, 0.4, 0);
  radius = MATCH_BALL_RADIUS;
  mass = 1.1;
  restitution = 0.6;
  grounded = false;
  /** Seconds since the ball last touched the ground. */
  airTime = 0;
  /** How long the ball has been trapped between a body and a wall. */
  jamTime = 0;
  /** Brief window after popping out of a scramble where bodies cannot re-trap it. */
  jamGrace = 0;

  get inertia(): number {
    // Solid-ish sphere shell mix, tuned for a football.
    return 0.4 * this.mass * this.radius * this.radius;
  }

  reset(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.prevPosition.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.grounded = false;
    this.airTime = 0;
    this.jamTime = 0;
    this.jamGrace = 0;
  }

  applyImpulse(ix: number, iy: number, iz: number): void {
    this.velocity.x += ix / this.mass;
    this.velocity.y += iy / this.mass;
    this.velocity.z += iz / this.mass;
  }

  get speed(): number {
    return this.velocity.length();
  }
}

/** Vertical capsule used for players (and any body that can push the ball). */
export interface CapsuleRef {
  index: number;
  /** Feet position. */
  position: Vec3;
  velocity: Vec3;
  radius: number;
  height: number;
  /** Extra forward offset of the capsule centre (used while sliding). */
  offsetX: number;
  offsetZ: number;
  /** Mass used for ball impulse exchange. */
  mass: number;
  /** 0..1 how "hard" the body currently is (slides/challenges hit harder). */
  hardness: number;
}

export class PhysicsWorld {
  ground: GroundSurface = { y: 0, friction: 0.62, restitution: 0.5, rollingResistance: 0.3 };
  material: PhysicsMaterial = { ...DEFAULT_MATERIAL };
  walls: WallCollider[] = [];
  posts: PostCollider[] = [];
  bars: BarCollider[] = [];
  contacts: ContactEvent[] = [];

  clear(): void {
    this.walls.length = 0;
    this.posts.length = 0;
    this.bars.length = 0;
  }

  private pushContact(
    kind: ContactEvent['kind'],
    impact: number,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    playerIndex?: number,
  ): void {
    if (this.contacts.length > 24) return;
    this.contacts.push({ kind, impact, x, y, z, nx, ny, nz, playerIndex });
  }

  /**
   * Advance the ball. Uses adaptive sub-stepping so fast shots cannot tunnel
   * through posts or walls.
   */
  stepBall(ball: BallBody, dt: number, capsules: readonly CapsuleRef[]): void {
    ball.prevPosition.copy(ball.position);
    const speed = ball.speed;
    const maxTravel = ball.radius * 0.45;
    const steps = clamp(Math.ceil((speed * dt) / maxTravel), 1, 10);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.integrate(ball, h);
      this.collideGround(ball);
      this.collideWalls(ball);
      this.collidePosts(ball);
      this.collideBars(ball);
      if (ball.jamGrace > 0) ball.jamGrace -= h;
      else for (const cap of capsules) this.collideCapsule(ball, cap, h);
      // A body shove must never leave the ball buried in the pitch or a wall.
      this.collideGround(ball);
      this.collideWalls(ball);
    }
    this.resolveJam(ball, dt, capsules);
    if (!ball.position.isFinite() || !ball.velocity.isFinite()) {
      ball.reset(0, 1, 0);
    }
  }

  /**
   * Anti-deadlock. A ball squeezed between a player and a wall - corners are the
   * classic case - can otherwise sit there forever while both players shove at
   * it. When that happens, pop it up and out of the pile, which is exactly what
   * a real ball does when it squirts out of a scramble.
   */
  /** Which walls (if any) the ball is currently resting against. */
  private wallPin(ball: BallBody): { x: number; z: number; count: number } {
    let x = 0;
    let z = 0;
    let count = 0;
    for (const w of this.walls) {
      if (ball.position.y - ball.radius > w.height) continue;
      if (ball.position.y + ball.radius < w.bottom) continue;
      const along = w.axis === 'x' ? ball.position.z : ball.position.x;
      if (along < w.min - ball.radius || along > w.max + ball.radius) continue;
      const across = w.axis === 'x' ? ball.position.x : ball.position.z;
      if (Math.abs(across - w.coord) - ball.radius > 0.14) continue;
      count++;
      if (w.axis === 'x') x += w.normalSign;
      else z += w.normalSign;
    }
    return { x, z, count };
  }

  /**
   * A ball squashed against a wall stops behaving like something you can walk
   * through: it holds the player off instead of being crushed into the geometry.
   */
  resolveCapsuleAgainstPinnedBall(cap: CapsuleRef, ball: BallBody): void {
    if (ball.position.y > cap.position.y + cap.height) return;
    if (!this.wallPin(ball).count) return;
    const cx = cap.position.x + cap.offsetX;
    const cz = cap.position.z + cap.offsetZ;
    let dx = cx - ball.position.x;
    let dz = cz - ball.position.z;
    const d = Math.hypot(dx, dz);
    const rsum = cap.radius + ball.radius;
    if (d > rsum || d < 1e-5) return;
    dx /= d;
    dz /= d;
    const pen = rsum - d;
    cap.position.x += dx * pen;
    cap.position.z += dz * pen;
    const vn = cap.velocity.x * dx + cap.velocity.z * dz;
    if (vn < 0) {
      cap.velocity.x -= vn * dx;
      cap.velocity.z -= vn * dz;
    }
  }

  private resolveJam(ball: BallBody, dt: number, capsules: readonly CapsuleRef[]): void {
    if (ball.speed > 3.4) {
      ball.jamTime = 0;
      return;
    }

    // Every wall the ball is currently leaning on (two of them in a corner).
    const pin = this.wallPin(ball);
    const normalX = pin.x;
    const normalZ = pin.z;
    if (!pin.count) {
      ball.jamTime = Math.max(0, ball.jamTime - dt * 2);
      return;
    }

    // The nearest body leaning on it.
    let bodyX = 0;
    let bodyZ = 0;
    let bodyGap = Infinity;
    for (const cap of capsules) {
      const cx = cap.position.x + cap.offsetX;
      const cz = cap.position.z + cap.offsetZ;
      const gap = Math.hypot(ball.position.x - cx, ball.position.z - cz) - cap.radius - ball.radius;
      if (gap < bodyGap) {
        bodyGap = gap;
        bodyX = cx;
        bodyZ = cz;
      }
    }
    if (bodyGap > 0.45) {
      ball.jamTime = Math.max(0, ball.jamTime - dt * 2);
      return;
    }

    ball.jamTime += dt;
    if (ball.jamTime < 0.6) return;
    ball.jamTime = 0;

    // Off the wall(s), along them away from the body, and high enough to clear
    // the legs that were trapping it.
    const awayX = ball.position.x - bodyX;
    const awayZ = ball.position.z - bodyZ;
    const awayLen = Math.hypot(awayX, awayZ) || 1;
    const tangentX = -normalZ;
    const tangentZ = normalX;
    const tangentSign = awayX * tangentX + awayZ * tangentZ >= 0 ? 1 : -1;
    let dirX = normalX + tangentX * tangentSign * 0.9 + (awayX / awayLen) * 0.35;
    let dirZ = normalZ + tangentZ * tangentSign * 0.9 + (awayZ / awayLen) * 0.35;
    const dl = Math.hypot(dirX, dirZ) || 1;
    dirX /= dl;
    dirZ /= dl;
    ball.velocity.x = dirX * 4.4;
    ball.velocity.z = dirZ * 4.4;
    ball.velocity.y = 6.2; // clears a standing player
    ball.grounded = false;
    ball.position.y += 0.05;
    ball.jamGrace = 0.3;
    this.pushContact('wall', 1.1, ball.position.x, ball.position.y, ball.position.z, dirX, 0, dirZ);
  }

  private integrate(ball: BallBody, dt: number): void {
    const m = this.material;
    const v = ball.velocity;
    const sp = v.length();

    // Quadratic air drag.
    if (sp > 0.01) {
      const drag = m.airDrag * sp;
      v.x -= v.x * drag * dt;
      v.y -= v.y * drag * dt;
      v.z -= v.z * drag * dt;
    }

    // Magnus effect (spin x velocity) - gives us curved shots and dipping volleys.
    if (!ball.grounded) {
      const w = ball.spin;
      const mx = w.y * v.z - w.z * v.y;
      const my = w.z * v.x - w.x * v.z;
      const mz = w.x * v.y - w.y * v.x;
      v.x += mx * m.magnus * dt;
      v.y += my * m.magnus * dt;
      v.z += mz * m.magnus * dt;
    }

    v.y += m.gravity * dt;
    v.clampLength(m.maxBallSpeed);

    ball.position.addScaled(v, dt);

    // Spin decay.
    const decay = Math.exp(-m.spinDecay * dt);
    ball.spin.scale(decay);

    ball.airTime += dt;
    if (ball.position.y - ball.radius > this.ground.y + 0.02) ball.grounded = false;
  }

  /**
   * Generic sphere contact resolution with friction + spin coupling.
   * n must be unit length and point away from the surface.
   */
  private resolveContact(
    ball: BallBody,
    nx: number,
    ny: number,
    nz: number,
    penetration: number,
    restitution: number,
    friction: number,
    kind: ContactEvent['kind'],
    damping = 0,
  ): void {
    if (penetration > 0) {
      ball.position.x += nx * penetration;
      ball.position.y += ny * penetration;
      ball.position.z += nz * penetration;
    }
    const v = ball.velocity;
    const vn = v.x * nx + v.y * ny + v.z * nz;
    if (vn > 0) return; // separating

    const impact = -vn;
    // Low-speed contacts settle instead of jittering.
    const e = impact < 1.1 ? restitution * 0.35 : restitution;

    // Contact point relative to centre.
    const rx = -nx * ball.radius;
    const ry = -ny * ball.radius;
    const rz = -nz * ball.radius;

    // Velocity at contact point (v + w x r).
    const w = ball.spin;
    const cvx = v.x + (w.y * rz - w.z * ry);
    const cvy = v.y + (w.z * rx - w.x * rz);
    const cvz = v.z + (w.x * ry - w.y * rx);

    // Normal impulse.
    const jn = -(1 + e) * vn * ball.mass;
    v.x += (jn / ball.mass) * nx;
    v.y += (jn / ball.mass) * ny;
    v.z += (jn / ball.mass) * nz;

    // Tangential (friction) impulse -> rolling / spin transfer.
    const cvn = cvx * nx + cvy * ny + cvz * nz;
    let tx = cvx - cvn * nx;
    let ty = cvy - cvn * ny;
    let tz = cvz - cvn * nz;
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tLen > 1e-5) {
      tx /= tLen;
      ty /= tLen;
      tz /= tLen;
      // Impulse that would stop slipping for a solid sphere: 2/7 m v_t
      let jt = (2 / 7) * ball.mass * tLen;
      const maxFriction = friction * Math.abs(jn);
      if (jt > maxFriction) jt = maxFriction;
      const ix = -tx * jt;
      const iy = -ty * jt;
      const iz = -tz * jt;
      v.x += ix / ball.mass;
      v.y += iy / ball.mass;
      v.z += iz / ball.mass;
      const I = ball.inertia;
      w.x += (ry * iz - rz * iy) / I;
      w.y += (rz * ix - rx * iz) / I;
      w.z += (rx * iy - ry * ix) / I;
    }

    if (damping > 0) {
      v.scale(1 - damping);
      w.scale(1 - damping);
    }

    if (impact > 0.35) {
      this.pushContact(
        kind,
        impact,
        ball.position.x - nx * ball.radius,
        ball.position.y - ny * ball.radius,
        ball.position.z - nz * ball.radius,
        nx,
        ny,
        nz,
      );
    }
  }

  private collideGround(ball: BallBody): void {
    const g = this.ground;
    const pen = g.y + ball.radius - ball.position.y;
    if (pen < 0) return;
    this.resolveContact(ball, 0, 1, 0, pen, g.restitution, g.friction, 'ground');
    ball.grounded = true;
    ball.airTime = 0;
    if (Math.abs(ball.velocity.y) < 0.55) ball.velocity.y = 0;
  }

  /** Rolling resistance + spin/velocity coupling while the ball rests on the pitch. */
  applyRolling(ball: BallBody, dt: number): void {
    if (!ball.grounded) return;
    const v = ball.velocity;
    const horizontal = Math.sqrt(v.x * v.x + v.z * v.z);
    if (horizontal > 1e-4) {
      const drop = Math.min(horizontal, this.ground.rollingResistance * dt);
      const s = (horizontal - drop) / horizontal;
      v.x *= s;
      v.z *= s;
    } else {
      v.x = 0;
      v.z = 0;
    }
    // Sync spin with rolling (ball rolls without slipping once settled).
    const r = ball.radius;
    const targetSpinX = v.z / r;
    const targetSpinZ = -v.x / r;
    const k = Math.min(1, dt * 7);
    ball.spin.x += (targetSpinX - ball.spin.x) * k;
    ball.spin.z += (targetSpinZ - ball.spin.z) * k;
    ball.spin.y *= Math.exp(-1.7 * dt);
  }

  private collideWalls(ball: BallBody): void {
    const p = ball.position;
    for (const wall of this.walls) {
      const top = wall.height;
      if (p.y - ball.radius > top) continue;
      if (p.y + ball.radius < wall.bottom) continue;
      const along = wall.axis === 'x' ? p.z : p.x;
      if (along < wall.min - ball.radius || along > wall.max + ball.radius) continue;
      const pos = wall.axis === 'x' ? p.x : p.z;
      // Distance from plane along the outward normal.
      const dist = (pos - wall.coord) * wall.normalSign;
      const pen = ball.radius - dist;
      if (pen <= 0 || pen > ball.radius * 2 + 0.6) continue;
      const nx = wall.axis === 'x' ? wall.normalSign : 0;
      const nz = wall.axis === 'z' ? wall.normalSign : 0;
      this.resolveContact(
        ball,
        nx,
        0,
        nz,
        pen,
        wall.restitution,
        wall.friction,
        wall.kind,
        wall.damping ?? 0,
      );
    }
  }

  private collidePosts(ball: BallBody): void {
    const p = ball.position;
    for (const post of this.posts) {
      if (p.y + ball.radius < post.yMin || p.y - ball.radius > post.yMax) continue;
      let dx = p.x - post.x;
      let dz = p.z - post.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const rsum = post.radius + ball.radius;
      if (d > rsum || d < 1e-6) continue;
      dx /= d;
      dz /= d;
      this.resolveContact(ball, dx, 0, dz, rsum - d, post.restitution, 0.35, 'post');
    }
  }

  private collideBars(ball: BallBody): void {
    const p = ball.position;
    for (const bar of this.bars) {
      const along = bar.axis === 'x' ? p.x : p.z;
      const clamped = clamp(along, bar.min, bar.max);
      const cx = bar.axis === 'x' ? clamped : bar.other;
      const cz = bar.axis === 'x' ? bar.other : clamped;
      let dx = p.x - cx;
      const dy = p.y - bar.y;
      let dz = p.z - cz;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rsum = bar.radius + ball.radius;
      if (d > rsum || d < 1e-6) continue;
      dx /= d;
      const ny = dy / d;
      dz /= d;
      d = rsum - d;
      this.resolveContact(ball, dx, ny, dz, d, bar.restitution, 0.3, 'crossbar');
    }
  }

  /** Ball vs player capsule: pushes the ball, transfers player momentum. */
  private collideCapsule(ball: BallBody, cap: CapsuleRef, dt: number): void {
    const cx = cap.position.x + cap.offsetX;
    const cz = cap.position.z + cap.offsetZ;
    const segBottom = cap.position.y + cap.radius;
    const segTop = cap.position.y + Math.max(cap.height - cap.radius, cap.radius + 0.01);
    const p = ball.position;
    const cy = clamp(p.y, segBottom, segTop);
    let dx = p.x - cx;
    let dy = p.y - cy;
    let dz = p.z - cz;
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rsum = cap.radius + ball.radius;
    if (d > rsum) return;
    if (d < 1e-5) {
      dx = 0.01;
      dy = 0;
      dz = 0;
      d = 0.01;
    }
    dx /= d;
    dy /= d;
    dz /= d;
    const pen = rsum - d;
    p.x += dx * pen;
    p.y += dy * pen;
    p.z += dz * pen;

    const v = ball.velocity;
    const pv = cap.velocity;
    // Relative velocity along the normal.
    const rvn = (v.x - pv.x) * dx + (v.y - pv.y) * dy + (v.z - pv.z) * dz;
    const restitution = 0.24 + cap.hardness * 0.5;
    if (rvn < 0) {
      const j = -(1 + restitution) * rvn;
      v.x += j * dx;
      v.y += j * dy;
      v.z += j * dz;
      if (rvn < -2.2) {
        this.pushContact('player', -rvn, p.x, p.y, p.z, dx, dy, dz, cap.index);
      }
    }
    // Dribble push. A body cannot walk through the ball, so the ball has to
    // leave at least as fast as the body is closing on it - this is what makes
    // running at the oversized match ball feel like shoving it along rather
    // than clipping into it.
    const pvn = pv.x * dx + pv.z * dz;
    const bvn = v.x * dx + v.z * dz;
    if (pvn > bvn) {
      const gain = (pvn - bvn) * (0.55 + cap.hardness * 0.45);
      v.x += dx * gain;
      v.z += dz * gain;
    }
    void dt;
    // Friction from the body brushing the ball adds a little spin.
    ball.spin.y += (pv.x * dz - pv.z * dx) * dt * 1.4;
  }

  /** Resolve a capsule against static walls/posts, keeping players on the pitch. */
  resolveCapsuleStatics(cap: CapsuleRef): void {
    for (const wall of this.walls) {
      if (wall.kind === 'net' || wall.kind === 'goalback') continue;
      if (wall.bottom > 0.4) continue;
      const along = wall.axis === 'x' ? cap.position.z : cap.position.x;
      if (along < wall.min - cap.radius || along > wall.max + cap.radius) continue;
      const pos = wall.axis === 'x' ? cap.position.x : cap.position.z;
      const dist = (pos - wall.coord) * wall.normalSign;
      const pen = cap.radius - dist;
      if (pen <= 0 || pen > cap.radius * 2 + 1.5) continue;
      if (wall.axis === 'x') {
        cap.position.x += wall.normalSign * pen;
        if (cap.velocity.x * wall.normalSign < 0) cap.velocity.x *= -0.15;
      } else {
        cap.position.z += wall.normalSign * pen;
        if (cap.velocity.z * wall.normalSign < 0) cap.velocity.z *= -0.15;
      }
    }
    for (const post of this.posts) {
      if (cap.position.y > post.yMax) continue;
      let dx = cap.position.x - post.x;
      let dz = cap.position.z - post.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const rsum = post.radius + cap.radius;
      if (d > rsum || d < 1e-6) continue;
      dx /= d;
      dz /= d;
      const pen = rsum - d;
      cap.position.x += dx * pen;
      cap.position.z += dz * pen;
      const vn = cap.velocity.x * dx + cap.velocity.z * dz;
      if (vn < 0) {
        cap.velocity.x -= vn * dx * 1.2;
        cap.velocity.z -= vn * dz * 1.2;
      }
    }
  }
}
