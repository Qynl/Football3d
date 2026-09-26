import * as THREE from 'three';
import { Vec3, angleDelta, angleLerp, clamp, clamp01, damp, lerp, yawFromDirection } from '../core/math.ts';
import type { ControlState } from '../input/input.ts';
import type { Ball } from '../ball/ball.ts';
import type { Arena } from '../arenas/arena.ts';
import type { CapsuleRef } from '../physics/world.ts';
import { CharacterRig, createPose, type RigPose } from '../characters/rig.ts';
import type { Archetype } from '../characters/characterDefs.ts';
import type { Cosmetics } from '../characters/characterDefs.ts';

export type FootballerState =
  | 'idle'
  | 'run'
  | 'air'
  | 'slide'
  | 'tackle'
  | 'stumble'
  | 'celebrate'
  | 'frozen';

export interface KickInfo {
  player: Footballer;
  charge: number;
  power: number;
  quick: boolean;
  lob: boolean;
  volley: boolean;
  position: Vec3;
  direction: Vec3;
}

export interface FoulInfo {
  offender: Footballer;
  victim: Footballer;
  position: Vec3;
  reason: 'slide' | 'charge' | 'aerial' | 'tackle';
}

export interface PlayerEvents {
  onKick?(info: KickInfo): void;
  onWhiff?(p: Footballer): void;
  onTouch?(p: Footballer, impact: number): void;
  onTackleWin?(p: Footballer): void;
  onSlideStart?(p: Footballer): void;
  onJump?(p: Footballer): void;
  onLand?(p: Footballer, impact: number): void;
  onBodyHit?(a: Footballer, b: Footballer, strength: number, at: Vec3): void;
  onFoul?(info: FoulInfo): void;
  onChargeTick?(p: Footballer, charge: number): void;
}

/** Shared base stats. Archetypes multiply these; nobody gets a hidden bonus. */
export const BASE = {
  walkSpeed: 6.5,
  sprintSpeed: 9.5,
  acceleration: 46,
  deceleration: 52,
  airAcceleration: 15,
  turnRate: 13,
  jumpVelocity: 7.6,
  gravity: -25.5,
  radius: 0.42,
  height: 1.72,
  mass: 74,
  kickMinSpeed: 8.5,
  kickMaxSpeed: 33.5,
  chargeTime: 1.05,
  quickTapTime: 0.11,
  kickReach: 1.18,
  kickCooldown: 0.16,
  tackleDuration: 0.3,
  tackleReach: 1.65,
  tackleCooldown: 0.5,
  slideDuration: 0.72,
  slideRecovery: 0.5,
  slideBoost: 5.9,
  challengeDuration: 0.26,
  challengeCooldown: 0.65,
  staminaMax: 100,
  staminaDrain: 17,
  staminaRegen: 21,
};

const UP = new Vec3(0, 1, 0);

export class Footballer {
  readonly index: number;
  readonly team: number;
  readonly position = new Vec3();
  readonly velocity = new Vec3();
  readonly rig: CharacterRig;
  readonly pose: RigPose = createPose();
  archetype: Archetype;
  isHuman: boolean;
  name = 'Player';

  yaw = 0;
  state: FootballerState = 'idle';
  grounded = true;
  stamina = BASE.staminaMax;

  // Kick state.
  charging = false;
  charge = 0;
  kickCooldown = 0;
  swingTimer = 0;
  swingTotal = 0;
  swingCharge = 0;
  swingLob = false;
  swingQuick = false;
  swingCurve = 0;
  kickLeg = 1;

  // Actions.
  tackleTimer = 0;
  tackleCooldown = 0;
  slideTimer = 0;
  slideRecovery = 0;
  slideTouchedBall = false;
  challengeTimer = 0;
  challengeCooldown = 0;
  stumbleTimer = 0;
  jumpCooldown = 0;
  celebrating: string | null = null;
  celebrationTime = 0;
  frozen = false;

  /** Time since this player last touched the ball (seconds). */
  timeSinceTouch = 99;
  /** Set when the player scores/concedes, for camera and stats. */
  lastKickPower = 0;

  readonly capsule: CapsuleRef;
  private events: PlayerEvents;
  private input: ControlState;
  private cameraYaw = 0;
  private inputFrame: 'camera' | 'world' = 'camera';
  /** Sideways input relative to the way the player is facing (-1 left, 1 right). */
  private lateralInput = 0;
  /** Yaw at the moment the wind-up started; the aim can only drift so far. */
  private chargeYaw = 0;
  private targetYaw = 0;
  private lastVelocity = new Vec3();
  private tmp = new Vec3();
  private tmp2 = new Vec3();
  private aimPitch = 0;
  private wasGrounded = true;
  /** Lateral input sampled during the kick charge - drives curve. */
  private curveInput = 0;
  private landingImpact = 0;
  private modifiers: PlayerModifiers;

  constructor(opts: {
    index: number;
    team: number;
    archetype: Archetype;
    cosmetics: Cosmetics;
    isHuman: boolean;
    events: PlayerEvents;
    name?: string;
    modifiers?: PlayerModifiers;
  }) {
    this.index = opts.index;
    this.team = opts.team;
    this.archetype = opts.archetype;
    this.isHuman = opts.isHuman;
    this.events = opts.events;
    this.name = opts.name ?? (opts.isHuman ? 'You' : 'CPU');
    this.modifiers = opts.modifiers ?? defaultModifiers();
    this.rig = new CharacterRig(opts.cosmetics);
    this.input = {
      moveX: 0,
      moveZ: 0,
      sprint: false,
      jumpPressed: false,
      kickHeld: false,
      kickPressed: false,
      kickReleased: false,
      tacklePressed: false,
      slidePressed: false,
      challengePressed: false,
      lobHeld: false,
      cameraPressed: false,
      aimYaw: 0,
      aimPitch: 0,
      active: false,
    };
    this.capsule = {
      index: opts.index,
      position: this.position,
      velocity: this.velocity,
      radius: BASE.radius,
      height: BASE.height,
      offsetX: 0,
      offsetZ: 0,
      mass: BASE.mass * this.archetype.mass,
      hardness: 0,
    };
  }

  setModifiers(m: PlayerModifiers): void {
    this.modifiers = m;
  }

  get maxSpeed(): number {
    const sprinting = this.input.sprint && this.stamina > 1;
    const base = sprinting
      ? BASE.sprintSpeed * this.archetype.sprintMultiplier
      : BASE.walkSpeed;
    return base * this.archetype.maxSpeed * this.modifiers.speed;
  }

  get isBusy(): boolean {
    return this.slideTimer > 0 || this.slideRecovery > 0 || this.stumbleTimer > 0;
  }

  /**
   * @param cameraYaw  yaw of the frame `state.moveX/moveZ` are expressed in.
   * @param frame      'camera' maps moveX to *screen right* (what a player
   *                   expects from A/D); 'world' takes moveX/moveZ as a plain
   *                   world-space direction, which is how the AI steers.
   */
  setInput(state: ControlState, cameraYaw: number, frame: 'camera' | 'world' = 'camera'): void {
    this.input = state;
    this.cameraYaw = cameraYaw;
    this.inputFrame = frame;
  }

  teleport(x: number, z: number, yaw: number): void {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.grounded = true;
    this.charging = false;
    this.charge = 0;
    this.swingTimer = 0;
    this.slideTimer = 0;
    this.slideRecovery = 0;
    this.tackleTimer = 0;
    this.stumbleTimer = 0;
    this.challengeTimer = 0;
    this.state = 'idle';
    this.stamina = BASE.staminaMax;
    this.celebrating = null;
  }

  celebrate(kind: string): void {
    this.celebrating = kind;
    this.celebrationTime = 0;
  }

  stopCelebrating(): void {
    this.celebrating = null;
  }

  /** Horizontal direction the player is facing. */
  facing(out = new Vec3()): Vec3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  update(dt: number, ball: Ball, arena: Arena, others: Footballer[]): void {
    this.timeSinceTouch += dt;
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.tackleCooldown = Math.max(0, this.tackleCooldown - dt);
    this.challengeCooldown = Math.max(0, this.challengeCooldown - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    if (this.celebrating) this.celebrationTime += dt;

    if (this.frozen) {
      this.velocity.x = damp(this.velocity.x, 0, 0.0001, dt);
      this.velocity.z = damp(this.velocity.z, 0, 0.0001, dt);
      this.integrate(dt, arena);
      return;
    }

    this.updateTimers(dt);
    this.updateAim(dt);
    this.updateMovement(dt, arena);
    this.updateActions(dt, ball, others);
    this.integrate(dt, arena);
    this.resolvePlayerCollisions(others);
    this.updateCapsule();
  }

  private updateTimers(dt: number): void {
    if (this.stumbleTimer > 0) this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);
    if (this.slideTimer > 0) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) {
        this.slideTimer = 0;
        this.slideRecovery = BASE.slideRecovery;
      }
    } else if (this.slideRecovery > 0) {
      this.slideRecovery = Math.max(0, this.slideRecovery - dt);
    }
    if (this.tackleTimer > 0) this.tackleTimer = Math.max(0, this.tackleTimer - dt);
    if (this.challengeTimer > 0) this.challengeTimer = Math.max(0, this.challengeTimer - dt);
  }

  private updateAim(dt: number): void {
    this.aimPitch = clamp(this.aimPitch + this.input.aimPitch, -0.5, 0.75);
    this.aimPitch = damp(this.aimPitch, this.aimPitch * 0.86, 0.35, dt);
  }

  /** Camera-relative movement, arcade acceleration model. */
  private updateMovement(dt: number, arena: Arena): void {
    const inp = this.input;
    const traction = arena.def.traction;

    // Move vector in world space.
    //
    // With yaw measured as atan2(x, z), forward is (sin, cos) and the vector
    // that appears to the *right* on screen is forward x up = (-cos, sin).
    // Getting that cross product backwards is what makes A and D swap.
    let wx: number;
    let wz: number;
    if (this.inputFrame === 'world') {
      wx = inp.moveX;
      wz = inp.moveZ;
    } else {
      const cos = Math.cos(this.cameraYaw);
      const sin = Math.sin(this.cameraYaw);
      wx = inp.moveZ * sin - inp.moveX * cos;
      wz = inp.moveZ * cos + inp.moveX * sin;
    }
    const inputLen = Math.hypot(wx, wz);
    if (inputLen > 1e-4) {
      wx /= inputLen;
      wz /= inputLen;
    }
    // How far the stick is pushed sideways relative to where the player looks.
    // Used for curve, so a right-hand press bends the shot to its right
    // whether it came from the keyboard or from the AI.
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.lateralInput = clamp(wx * -fz + wz * fx, -1, 1) * inputLen;

    // Stamina.
    const wantsSprint = inp.sprint && inputLen > 0.15 && this.grounded && this.slideTimer <= 0;
    if (wantsSprint && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - BASE.staminaDrain * dt);
    } else {
      this.stamina = Math.min(
        BASE.staminaMax,
        this.stamina + BASE.staminaRegen * dt * (inputLen > 0.1 ? 0.75 : 1.4),
      );
    }

    let speedCap = this.maxSpeed;
    // Charging a big shot slows you down: commitment is a real cost.
    if (this.charging) speedCap *= lerp(1, 0.52, clamp01(this.charge));
    if (this.swingTimer > 0) speedCap *= 0.5;
    if (this.stumbleTimer > 0) speedCap *= 0.4;

    if (this.slideTimer > 0) {
      // Slides keep their momentum and cannot be steered much.
      // Slides glide: that is the whole risk/reward of committing to one.
      const decel = (traction < 0.6 ? 2.2 : 4.9) + 2.4 * traction;
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      const newSp = Math.max(0, sp - decel * dt);
      if (sp > 1e-4) {
        this.velocity.x *= newSp / sp;
        this.velocity.z *= newSp / sp;
      }
      // Tiny steering.
      this.velocity.x += wx * 3.2 * dt * traction;
      this.velocity.z += wz * 3.2 * dt * traction;
      return;
    }

    const accel =
      (this.grounded ? BASE.acceleration * traction : BASE.airAcceleration * this.archetype.airControl) *
      this.archetype.acceleration *
      this.modifiers.acceleration *
      (this.stumbleTimer > 0 ? 0.3 : 1);

    const targetVx = wx * speedCap;
    const targetVz = wz * speedCap;

    if (inputLen > 0.05) {
      const dvx = targetVx - this.velocity.x;
      const dvz = targetVz - this.velocity.z;
      const dl = Math.hypot(dvx, dvz);
      if (dl > 1e-4) {
        const step = Math.min(dl, accel * dt);
        this.velocity.x += (dvx / dl) * step;
        this.velocity.z += (dvz / dl) * step;
      }
      let desiredYaw = yawFromDirection(wx, wz);
      if (this.charging || this.swingTimer > 0) {
        // Winding up locks your aim: sideways input bends the ball instead of
        // spinning the body, which is what makes curled shots controllable.
        const off = angleDelta(this.yaw, desiredYaw);
        const lock = this.swingTimer > 0 ? 0.12 : lerp(1, 0.22, clamp01(this.charge * 1.4));
        desiredYaw = this.yaw + clamp(off, -0.6, 0.6) * lock;
        // Hard limit on how far the aim can wander from where the wind-up
        // started, so holding a direction curls the shot instead of slowly
        // spinning the player away from the target.
        const drift = angleDelta(this.chargeYaw, desiredYaw);
        desiredYaw = this.chargeYaw + clamp(drift, -0.5, 0.5);
      }
      this.targetYaw = desiredYaw;
    } else if (this.grounded) {
      // Natural stop.
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      // Low-traction surfaces do not merely accelerate badly, they refuse to
      // stop: that is what makes the ice arena feel like ice.
      const slip = traction < 0.7 ? traction * traction : traction;
      // Being barged off balance means you cannot just plant your feet.
      const stagger = this.stumbleTimer > 0 ? 0.18 : 1;
      const decel = BASE.deceleration * slip * this.archetype.acceleration * stagger;
      const newSp = Math.max(0, sp - decel * dt);
      if (sp > 1e-4) {
        this.velocity.x *= newSp / sp;
        this.velocity.z *= newSp / sp;
      }
    }

    // Hard cap (momentum from collisions may exceed it briefly, that's fine).
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const hardCap = speedCap * 1.55;
    if (sp > hardCap) {
      this.velocity.x *= hardCap / sp;
      this.velocity.z *= hardCap / sp;
    }

    // Turning.
    const turn = BASE.turnRate * (this.grounded ? 1 : 0.55) * (this.charging ? 0.8 : 1);
    this.yaw = angleLerp(this.yaw, this.targetYaw, clamp01(turn * dt));

    // Jump.
    if (inp.jumpPressed && this.grounded && this.jumpCooldown <= 0 && this.slideTimer <= 0) {
      this.velocity.y =
        BASE.jumpVelocity * this.archetype.jump * this.modifiers.jump;
      this.grounded = false;
      this.jumpCooldown = 0.28;
      this.events.onJump?.(this);
    }
  }

  private updateActions(dt: number, ball: Ball, others: Footballer[]): void {
    const inp = this.input;

    // ---- Kick charge ----
    if (this.swingTimer > 0) {
      const before = this.swingTimer;
      this.swingTimer -= dt;
      const contactAt = this.swingTotal * 0.55;
      if (before > contactAt && this.swingTimer <= contactAt) {
        this.executeKick(ball);
      }
      if (this.swingTimer <= 0) this.swingTimer = 0;
    }

    if (
      inp.kickPressed &&
      !this.charging &&
      this.canAct() &&
      this.kickCooldown <= 0 &&
      this.swingTimer <= 0
    ) {
      this.charging = true;
      this.charge = 0;
      this.chargeYaw = this.yaw;
    }
    if (this.charging) {
      if (inp.kickHeld) {
        this.charge = clamp01(this.charge + dt / BASE.chargeTime);
        // Sample lateral input for curve.
        this.curveInput = damp(this.curveInput, this.lateralInput, 0.02, dt);
        this.events.onChargeTick?.(this, this.charge);
        if (!this.canAct()) this.releaseKick(ball);
      } else {
        this.releaseKick(ball);
      }
    }

    // ---- Tackle ----
    if (inp.tacklePressed && this.canAct() && this.tackleCooldown <= 0 && this.grounded) {
      this.tackleTimer = BASE.tackleDuration;
      this.tackleCooldown = BASE.tackleCooldown;
      // Small lunge.
      const f = this.facing(this.tmp);
      this.velocity.x += f.x * 3.4;
      this.velocity.z += f.z * 3.4;
      this.tackleResolved = false;
    }
    if (this.tackleTimer > 0) this.resolveTackle(ball, others);

    // ---- Slide ----
    if (
      inp.slidePressed &&
      this.canAct() &&
      this.grounded &&
      this.slideTimer <= 0 &&
      this.slideRecovery <= 0
    ) {
      this.startSlide();
    }
    if (this.slideTimer > 0) this.resolveSlide(ball, others);

    // ---- Body challenge ----
    if (inp.challengePressed && this.canAct() && this.challengeCooldown <= 0) {
      this.challengeTimer = BASE.challengeDuration;
      this.challengeCooldown = BASE.challengeCooldown;
      const f = this.facing(this.tmp);
      this.velocity.x += f.x * 2.6;
      this.velocity.z += f.z * 2.6;
    }
    if (this.challengeTimer > 0) this.resolveChallenge(others, ball);

    this.capsule.hardness =
      this.slideTimer > 0 ? 1 : this.challengeTimer > 0 ? 0.75 : this.tackleTimer > 0 ? 0.45 : 0;
  }

  private tackleResolved = false;

  canAct(): boolean {
    return (
      !this.frozen &&
      this.slideTimer <= 0 &&
      this.slideRecovery <= 0 &&
      this.stumbleTimer <= 0 &&
      !this.celebrating
    );
  }

  private startSlide(): void {
    const f = this.facing(this.tmp);
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const boost = BASE.slideBoost + sp * 0.35;
    this.velocity.x = f.x * (sp * 0.35 + boost);
    this.velocity.z = f.z * (sp * 0.35 + boost);
    this.slideTimer = BASE.slideDuration;
    this.slideTouchedBall = false;
    this.charging = false;
    this.charge = 0;
    this.events.onSlideStart?.(this);
  }

  /** Quick poke tackle: reach for the ball, or clatter into a body. */
  private resolveTackle(ball: Ball, others: Footballer[]): void {
    if (this.tackleResolved) return;
    const f = this.facing(this.tmp);
    const reach = BASE.tackleReach * this.archetype.reach;
    const cx = this.position.x + f.x * reach * 0.55;
    const cz = this.position.z + f.z * reach * 0.55;
    const b = ball.body.position;
    const dx = b.x - cx;
    const dz = b.z - cz;
    const dy = b.y - (this.position.y + 0.35);
    const distSq = dx * dx + dz * dz;
    if (distSq < reach * reach * 0.62 && dy < 1.1 && dy > -0.6) {
      // Won the ball.
      this.tackleResolved = true;
      const speed = 9 + Math.hypot(this.velocity.x, this.velocity.z) * 0.5;
      const dirX = f.x * 0.75 + dx * 0.5;
      const dirZ = f.z * 0.75 + dz * 0.5;
      const dl = Math.hypot(dirX, dirZ) || 1;
      ball.body.velocity.x = (dirX / dl) * speed;
      ball.body.velocity.z = (dirZ / dl) * speed;
      ball.body.velocity.y = Math.max(ball.body.velocity.y, 1.8);
      ball.body.spin.y += this.curveInput * 4;
      ball.impact(0.6);
      this.timeSinceTouch = 0;
      this.events.onTackleWin?.(this);
      this.events.onTouch?.(this, speed);
      return;
    }
    // Body contact without the ball = foul.
    for (const o of others) {
      if (o === this) continue;
      const odx = o.position.x - cx;
      const odz = o.position.z - cz;
      const d2 = odx * odx + odz * odz;
      if (d2 < (reach * 0.72 + o.capsule.radius) ** 2 && Math.abs(o.position.y - this.position.y) < 1.2) {
        this.tackleResolved = true;
        const ballFar = ball.body.position.horizontalDistanceTo(o.position) > 2.0;
        const speed = Math.hypot(this.velocity.x, this.velocity.z);
        if (ballFar && speed > 4.2) {
          this.commitFoul(o, 'tackle');
        } else {
          this.bump(o, 0.6);
        }
        return;
      }
    }
  }

  private resolveSlide(ball: Ball, others: Footballer[]): void {
    const f = this.facing(this.tmp);
    const reach = 1.25 * this.archetype.reach;
    const cx = this.position.x + f.x * 0.55;
    const cz = this.position.z + f.z * 0.55;
    const b = ball.body.position;
    const dx = b.x - cx;
    const dz = b.z - cz;
    const dy = b.y - this.position.y;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (dx * dx + dz * dz < reach * reach && dy < 1.0 && !this.slideTouchedBall) {
      this.slideTouchedBall = true;
      const power = 10 + speed * 1.35;
      const dirX = f.x * 0.7 + dx * 0.6;
      const dirZ = f.z * 0.7 + dz * 0.6;
      const dl = Math.hypot(dirX, dirZ) || 1;
      ball.body.velocity.x = (dirX / dl) * power;
      ball.body.velocity.z = (dirZ / dl) * power;
      ball.body.velocity.y = Math.max(ball.body.velocity.y, 3.2 + speed * 0.14);
      ball.body.spin.x += 6;
      ball.impact(0.85);
      this.timeSinceTouch = 0;
      this.events.onTackleWin?.(this);
      this.events.onTouch?.(this, power);
    }
    for (const o of others) {
      if (o === this) continue;
      const odx = o.position.x - cx;
      const odz = o.position.z - cz;
      const d2 = odx * odx + odz * odz;
      const hitRange = (reach * 0.85 + o.capsule.radius) ** 2;
      if (d2 < hitRange && Math.abs(o.position.y - this.position.y) < 1.3) {
        if (!this.slideTouchedBall && speed > 3.2) {
          this.commitFoul(o, 'slide');
          this.slideTimer = Math.min(this.slideTimer, 0.08);
        } else if (speed > 2) {
          this.bump(o, 0.75);
        }
      }
    }
  }

  private resolveChallenge(others: Footballer[], ball: Ball): void {
    const f = this.facing(this.tmp);
    const reach = 1.5;
    for (const o of others) {
      if (o === this) continue;
      const dx = o.position.x - this.position.x;
      const dz = o.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + o.capsule.radius) continue;
      const align = (dx * f.x + dz * f.z) / (dist || 1);
      if (align < 0.2) continue;
      if (Math.abs(o.position.y - this.position.y) > 1.4) continue;
      const strength = this.archetype.bodyStrength * (1 + Math.hypot(this.velocity.x, this.velocity.z) * 0.1);
      const ballFar = ball.body.position.horizontalDistanceTo(o.position) > 2.6;
      const airborne = !o.grounded || !this.grounded;
      this.challengeTimer = 0;
      if (ballFar && strength > 1.35) {
        this.commitFoul(o, airborne ? 'aerial' : 'charge');
      } else {
        this.bump(o, 1.15 * strength);
      }
      return;
    }
  }

  /** Physical shove: momentum transfer, readable knockback. */
  bump(target: Footballer, strength: number): void {
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = dx / d;
    const nz = dz / d;
    const myMomentum = Math.hypot(this.velocity.x, this.velocity.z) * this.archetype.mass;
    const theirMomentum = Math.hypot(target.velocity.x, target.velocity.z) * target.archetype.mass;
    const ratio = clamp(myMomentum / Math.max(1, theirMomentum + myMomentum), 0.2, 0.9);
    const push = (2.4 + myMomentum * 0.055) * strength * ratio * (this.archetype.bodyStrength / target.archetype.bodyStrength);
    target.velocity.x += nx * push;
    target.velocity.z += nz * push;
    this.velocity.x -= nx * push * 0.35;
    this.velocity.z -= nz * push * 0.35;
    if (push > 2.1) {
      target.stumbleTimer = Math.max(target.stumbleTimer, clamp(push * 0.12, 0.25, 0.6));
      target.charging = false;
      target.charge = 0;
    }
    this.tmp2.set(
      (this.position.x + target.position.x) / 2,
      1,
      (this.position.z + target.position.z) / 2,
    );
    this.events.onBodyHit?.(this, target, push, this.tmp2);
  }

  private commitFoul(victim: Footballer, reason: FoulInfo['reason']): void {
    const at = new Vec3(
      (this.position.x + victim.position.x) / 2,
      0,
      (this.position.z + victim.position.z) / 2,
    );
    victim.stumbleTimer = Math.max(victim.stumbleTimer, 0.55);
    victim.charging = false;
    victim.charge = 0;
    this.bump(victim, 1.3);
    this.events.onFoul?.({ offender: this, victim, position: at, reason });
  }

  // ---------------------------------------------------------------- kicking

  private releaseKick(ball: Ball): void {
    if (!this.charging) return;
    const charge = this.charge;
    this.charging = false;
    this.charge = 0;
    const quick = charge < BASE.quickTapTime / BASE.chargeTime;
    this.swingQuick = quick;
    this.swingCharge = charge;
    this.swingLob = this.input.lobHeld;
    this.swingCurve = this.curveInput;
    this.curveInput = 0;
    this.swingTotal = quick ? 0.16 : 0.2 + charge * 0.22;
    this.swingTimer = this.swingTotal;
    this.kickCooldown = this.swingTotal + (quick ? 0.06 : 0.12 + charge * 0.16);
    this.kickLeg = this.kickLeg > 0 ? -1 : 1;
    void ball;
  }

  /** The actual ball contact, resolved mid-swing. Miss = whiff. */
  private executeKick(ball: Ball): void {
    const b = ball.body;
    const charge = this.swingCharge;
    const f = this.facing(this.tmp);
    const reach = (BASE.kickReach + charge * 0.22) * this.archetype.reach + ball.body.radius;

    // Contact point is just in front of the kicking foot.
    const cx = this.position.x + f.x * 0.32;
    const cz = this.position.z + f.z * 0.32;
    const dx = b.position.x - cx;
    const dz = b.position.z - cz;
    // The boot meets the lower half of the ball, so the contact height scales
    // with the ball: this keeps the loft behaviour identical for a giant chaos
    // ball, a normal one and a tiny one.
    const footY = this.position.y + Math.min(0.25, b.radius * 0.7);
    const dy = b.position.y - footY;
    const horiz = Math.hypot(dx, dz);
    const verticalOk = dy > -0.75 && dy < 1.55;
    if (horiz > reach || !verticalOk) {
      this.events.onWhiff?.(this);
      return;
    }

    // Alignment: kicking behind you is possible (back-heel) but weaker.
    const toBallX = horiz > 1e-4 ? dx / horiz : f.x;
    const toBallZ = horiz > 1e-4 ? dz / horiz : f.z;
    const align = clamp(toBallX * f.x + toBallZ * f.z, -1, 1);
    const alignFactor = lerp(0.42, 1, (align + 1) / 2);

    // ---- Power: continuous function of charge, never a fixed set of tiers ----
    const curve = Math.pow(charge, 0.82);
    let speed = lerp(BASE.kickMinSpeed, BASE.kickMaxSpeed, curve);
    if (this.swingQuick) speed = BASE.kickMinSpeed * 0.82;
    speed *= this.archetype.kickPower * alignFactor * this.modifiers.kickPower;
    // Kicking while airborne or off balance is less clean.
    if (!this.grounded) speed *= this.velocity.y < -1 ? 0.86 : 0.93;
    if (this.stumbleTimer > 0) speed *= 0.6;

    // ---- Direction ----
    const dir = new Vec3(f.x, 0, f.z);
    // Momentum steers the ball: sprinting sideways sends it at an angle.
    dir.x += this.velocity.x * 0.055;
    dir.z += this.velocity.z * 0.055;
    // Contact geometry: hitting the ball off-centre deflects it.
    dir.x += toBallX * 0.42;
    dir.z += toBallZ * 0.42;
    dir.y = 0;
    dir.normalize();

    // ---- Loft ----
    // Under the ball -> it lifts. Charge flattens the shot. Lob modifier chips it.
    const underness = clamp01((0.34 - dy) * 0.9 + 0.22);
    let loft = lerp(0.36, 0.1, curve) * underness;
    if (this.swingLob) loft += 0.72;
    if (dy > 0.35) loft += clamp((dy - 0.35) * 0.55, 0, 0.55); // scooping a high ball
    loft += this.aimPitch * 0.55;
    if (!this.grounded && this.velocity.y < -2) loft += 0.22; // awkward falling kick
    loft = clamp(loft, -0.28, 1.5);

    const horizontalSpeed = speed / Math.sqrt(1 + loft * loft);
    const vy = horizontalSpeed * loft;

    // ---- Apply impulse ----
    b.velocity.x = dir.x * horizontalSpeed + this.velocity.x * 0.3;
    b.velocity.z = dir.z * horizontalSpeed + this.velocity.z * 0.3;
    b.velocity.y = vy + Math.max(0, this.velocity.y) * 0.35;
    b.grounded = false;

    // ---- Spin ----
    const curveAmount =
      (this.swingCurve * 0.75 + this.velocity.x * dir.z * 0.02 - this.velocity.z * dir.x * 0.02) *
      this.archetype.curve *
      this.modifiers.curve;
    b.spin.y = -curveAmount * (7 + charge * 26);
    // Back/top spin from where the foot met the ball.
    const spinAxisX = -dir.z;
    const spinAxisZ = dir.x;
    const topSpin = lerp(-0.9, 0.5, clamp01(underness)) * (6 + charge * 16);
    b.spin.x = spinAxisX * topSpin;
    b.spin.z = spinAxisZ * topSpin;

    // Push the ball clear of the body so it does not immediately re-collide.
    b.position.x += dir.x * 0.06;
    b.position.z += dir.z * 0.06;
    b.position.y += 0.02;

    ball.impact(0.4 + charge * 0.6);
    this.timeSinceTouch = 0;
    this.lastKickPower = speed;
    this.events.onKick?.({
      player: this,
      charge,
      power: speed,
      quick: this.swingQuick,
      lob: this.swingLob,
      volley: !this.grounded,
      position: new Vec3(b.position.x, b.position.y, b.position.z),
      direction: new Vec3(b.velocity.x, b.velocity.y, b.velocity.z).normalize(),
    });
  }

  // ------------------------------------------------------------- integration

  private integrate(dt: number, arena: Arena): void {
    this.lastVelocity.copy(this.velocity);
    this.velocity.y += BASE.gravity * this.modifiers.gravity * dt;
    this.position.addScaled(this.velocity, dt);

    if (this.position.y <= 0) {
      if (!this.wasGrounded) {
        this.landingImpact = -this.velocity.y;
        this.events.onLand?.(this, this.landingImpact);
        if (this.landingImpact > 12) this.stumbleTimer = Math.max(this.stumbleTimer, 0.2);
      }
      this.position.y = 0;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.wasGrounded = this.grounded;

    arena.clampPlayer(this.position, BASE.radius);

    // State for animation + AI reasoning.
    if (this.frozen) this.state = 'frozen';
    else if (this.celebrating) this.state = 'celebrate';
    else if (this.slideTimer > 0) this.state = 'slide';
    else if (this.stumbleTimer > 0) this.state = 'stumble';
    else if (!this.grounded) this.state = 'air';
    else if (this.tackleTimer > 0) this.state = 'tackle';
    else if (Math.hypot(this.velocity.x, this.velocity.z) > 0.6) this.state = 'run';
    else this.state = 'idle';
  }

  private resolvePlayerCollisions(others: Footballer[]): void {
    for (const o of others) {
      if (o === this || o.index < this.index) continue;
      const dx = o.position.x - this.position.x;
      const dz = o.position.z - this.position.z;
      const dyGap = Math.abs(o.position.y - this.position.y);
      if (dyGap > BASE.height * 0.9) continue;
      const rsum = this.capsule.radius + o.capsule.radius;
      const d = Math.hypot(dx, dz);
      if (d > rsum || d < 1e-5) continue;
      const nx = dx / d;
      const nz = dz / d;
      const pen = rsum - d;
      const m1 = this.capsule.mass;
      const m2 = o.capsule.mass;
      const total = m1 + m2;
      this.position.x -= nx * pen * (m2 / total);
      this.position.z -= nz * pen * (m2 / total);
      o.position.x += nx * pen * (m1 / total);
      o.position.z += nz * pen * (m1 / total);

      // Momentum exchange along the contact normal.
      const v1n = this.velocity.x * nx + this.velocity.z * nz;
      const v2n = o.velocity.x * nx + o.velocity.z * nz;
      const closing = v1n - v2n;
      if (closing > 0) {
        const e = 0.35;
        const j = ((1 + e) * closing) / (1 / m1 + 1 / m2);
        this.velocity.x -= (j / m1) * nx;
        this.velocity.z -= (j / m1) * nz;
        o.velocity.x += (j / m2) * nx;
        o.velocity.z += (j / m2) * nz;
        if (closing > 6.5) {
          const loser = m1 * this.archetype.bodyStrength < m2 * o.archetype.bodyStrength ? this : o;
          loser.stumbleTimer = Math.max(loser.stumbleTimer, clamp(closing * 0.045, 0.15, 0.45));
          loser.charging = false;
          this.tmp2.set((this.position.x + o.position.x) / 2, 1, (this.position.z + o.position.z) / 2);
          this.events.onBodyHit?.(this, o, closing, this.tmp2);
        }
      }
    }
  }

  private updateCapsule(): void {
    const sliding = this.slideTimer > 0;
    this.capsule.radius = sliding ? 0.5 : BASE.radius;
    this.capsule.height = sliding ? 0.62 : BASE.height;
    const f = this.facing(this.tmp);
    this.capsule.offsetX = sliding ? f.x * 0.42 : 0;
    this.capsule.offsetZ = sliding ? f.z * 0.42 : 0;
    this.capsule.mass = BASE.mass * this.archetype.mass;
  }

  /**
   * Visual-only update, driven by the render frame rather than the fixed sim
   * step. `lookAt` is where the head should glance - usually the ball.
   */
  updateVisual(dt: number, lookAt?: { x: number; y: number; z: number }): void {
    const pose = this.pose;
    pose.speed = Math.hypot(this.velocity.x, this.velocity.z);
    pose.maxSpeed = BASE.sprintSpeed;
    pose.grounded = this.grounded;
    pose.verticalVelocity = this.velocity.y;
    pose.slide = damp(pose.slide, this.slideTimer > 0 ? 1 : 0, 0.00001, dt);
    pose.charge = this.charge;
    pose.kickSwing = this.swingTotal > 0 ? clamp01(this.swingTimer / this.swingTotal) : 0;
    pose.kickLeg = this.kickLeg;
    pose.tackle = damp(pose.tackle, this.tackleTimer > 0 ? 1 : 0, 0.00005, dt);
    pose.stumble = damp(pose.stumble, this.stumbleTimer > 0 ? 1 : 0, 0.0001, dt);
    pose.celebration = this.celebrating;
    pose.celebrationTime = this.celebrationTime;
    const ax = (this.velocity.x - this.lastVelocity.x) / Math.max(dt, 1e-4);
    const az = (this.velocity.z - this.lastVelocity.z) / Math.max(dt, 1e-4);
    const f = this.facing(this.tmp);
    const right = this.tmp2.set(-f.z, 0, f.x);
    pose.leanZ = clamp((ax * f.x + az * f.z) / 40, -1, 1);
    pose.leanX = clamp((ax * right.x + az * right.z) / 40, -1, 1);
    // Which way the body is travelling relative to where it looks, so the rig
    // can backpedal and side-step instead of always running forwards.
    const speed = Math.max(0.001, pose.speed);
    pose.driveZ = clamp((this.velocity.x * f.x + this.velocity.z * f.z) / speed, -1, 1) *
      clamp01(speed / 1.5);
    pose.driveX = clamp((this.velocity.x * right.x + this.velocity.z * right.z) / speed, -1, 1) *
      clamp01(speed / 1.5);
    if (lookAt) {
      pose.lookX = lookAt.x;
      pose.lookY = lookAt.y;
      pose.lookZ = lookAt.z;
    }

    this.rig.root.position.set(this.position.x, this.position.y, this.position.z);
    this.rig.root.rotation.y = this.yaw;
    this.rig.update(dt, pose, 0);
  }

  /** World-space position of the head/chest, used for aerial checks. */
  chest(out = new Vec3()): Vec3 {
    return out.set(this.position.x, this.position.y + 1.1, this.position.z);
  }

  get object3D(): THREE.Object3D {
    return this.rig.root;
  }

  get upVector(): Vec3 {
    return UP;
  }
}

export interface PlayerModifiers {
  speed: number;
  acceleration: number;
  jump: number;
  gravity: number;
  kickPower: number;
  curve: number;
}

export function defaultModifiers(): PlayerModifiers {
  return { speed: 1, acceleration: 1, jump: 1, gravity: 1, kickPower: 1, curve: 1 };
}
