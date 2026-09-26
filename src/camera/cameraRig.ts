import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math.ts';
import type { Footballer } from '../player/footballer.ts';
import type { Ball } from '../ball/ball.ts';

export type CameraMode = 'ball' | 'player' | 'broadcast';

/**
 * Third-person camera that always answers three questions:
 * where am I, where is the ball, where is the goal.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'ball';
  private pos = new THREE.Vector3(0, 6, -14);
  private look = new THREE.Vector3();
  private shake = 0;
  private shakeTime = 0;
  private yawOffset = 0;
  private pitchOffset = 0;
  private freeYaw = 0;
  private distance = 9.5;
  private height = 4.2;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private cinematic: { active: boolean; time: number; center: THREE.Vector3; radius: number } = {
    active: false,
    time: 0,
    center: new THREE.Vector3(),
    radius: 9,
  };
  fov = 62;
  shakeScale = 1;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.1, 400);
    this.camera.position.copy(this.pos);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.6, this.shake + amount * this.shakeScale);
  }

  aim(yawDelta: number, pitchDelta: number): void {
    this.yawOffset = clamp(this.yawOffset + yawDelta, -1.15, 1.15);
    this.pitchOffset = clamp(this.pitchOffset + pitchDelta, -0.45, 0.6);
    this.freeYaw += yawDelta;
  }

  startCinematic(center: THREE.Vector3, radius = 9): void {
    this.cinematic.active = true;
    this.cinematic.time = 0;
    this.cinematic.center.copy(center);
    this.cinematic.radius = radius;
  }

  stopCinematic(): void {
    this.cinematic.active = false;
  }

  /** Snap behind the player, used at kickoff so the first frame is never wild. */
  snap(player: Footballer, ball: Ball): void {
    this.update(0.2, player, ball, 1);
    this.camera.position.copy(this.pos);
  }

  update(dt: number, player: Footballer, ball: Ball, snapFactor = 0): void {
    this.shakeTime += dt;
    if (this.cinematic.active) {
      this.cinematic.time += dt;
      const a = this.cinematic.time * 0.7;
      const c = this.cinematic.center;
      this.pos.set(
        c.x + Math.sin(a) * this.cinematic.radius,
        c.y + 3.4 + Math.sin(a * 0.6) * 0.8,
        c.z + Math.cos(a) * this.cinematic.radius,
      );
      this.camera.position.lerp(this.pos, 1 - Math.pow(0.0005, dt));
      this.look.lerp(c, 1 - Math.pow(0.0008, dt));
      this.camera.lookAt(this.look);
      this.applyShake(dt);
      return;
    }

    if (this.mode === 'broadcast') {
      this.updateBroadcast(dt, player, ball, snapFactor);
      this.applyShake(dt);
      return;
    }

    const p = this.tmpA.set(player.position.x, player.position.y, player.position.z);
    const b = this.tmpB.set(ball.body.position.x, ball.body.position.y, ball.body.position.z);
    const toBall = b.clone().sub(p);
    const ballDist = Math.hypot(toBall.x, toBall.z);
    const ballSpeed = ball.body.speed;

    // Base direction the camera sits along (behind the player, away from the ball).
    let dirX: number;
    let dirZ: number;
    if (this.mode === 'ball' && ballDist > 1.6) {
      dirX = -toBall.x / ballDist;
      dirZ = -toBall.z / ballDist;
    } else {
      // Fall back to the player's facing so we never spin wildly at close range.
      const f = player.facing();
      dirX = -f.x;
      dirZ = -f.z;
    }
    if (this.mode === 'player') {
      dirX = -Math.sin(this.freeYaw);
      dirZ = -Math.cos(this.freeYaw);
    }

    // Apply the player's manual orbit offset.
    const cos = Math.cos(this.yawOffset);
    const sin = Math.sin(this.yawOffset);
    const ox = dirX * cos - dirZ * sin;
    const oz = dirX * sin + dirZ * cos;

    // Dynamic framing: pull back for speed, rise for aerials.
    const speedZoom = clamp(ballSpeed / 30, 0, 1);
    const airZoom = clamp((ball.body.position.y - 1.5) / 6, 0, 1);
    const distanceTarget =
      8.4 + speedZoom * 2.6 + airZoom * 2.2 + clamp(ballDist * 0.16, 0, 3.4);
    const heightTarget = 3.7 + speedZoom * 0.9 + airZoom * 3.4 + clamp(ballDist * 0.07, 0, 1.6);
    this.distance = damp(this.distance, distanceTarget, 0.02, dt);
    this.height = damp(this.height, heightTarget, 0.02, dt);

    const pitch = this.pitchOffset;
    const desiredX = p.x + ox * this.distance * Math.cos(pitch * 0.6);
    const desiredZ = p.z + oz * this.distance * Math.cos(pitch * 0.6);
    const desiredY = p.y + this.height + pitch * 4.5;

    // Look at a point biased from the player towards the ball.
    const bias = clamp(0.22 + ballDist * 0.022, 0.2, 0.46);
    const lookX = lerp(p.x, b.x, bias);
    const lookY = lerp(p.y + 1.15, b.y + 0.35, bias * 0.85);
    const lookZ = lerp(p.z, b.z, bias);

    const smooth = snapFactor > 0 ? snapFactor : 1 - Math.pow(0.0009, dt);
    this.pos.set(
      lerp(this.pos.x, desiredX, smooth),
      lerp(this.pos.y, Math.max(1.4, desiredY), smooth),
      lerp(this.pos.z, desiredZ, smooth),
    );
    const lookSmooth = snapFactor > 0 ? snapFactor : 1 - Math.pow(0.0006, dt);
    this.look.set(
      lerp(this.look.x, lookX, lookSmooth),
      lerp(this.look.y, lookY, lookSmooth),
      lerp(this.look.z, lookZ, lookSmooth),
    );

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // Subtle FOV kick with speed and while charging a shot.
    const targetFov = this.fov + speedZoom * 5 - player.charge * 4.5;
    this.camera.fov = damp(this.camera.fov, targetFov, 0.02, dt);
    this.camera.updateProjectionMatrix();

    // Decay the manual orbit back to neutral so the camera self-corrects.
    this.yawOffset = damp(this.yawOffset, 0, 0.55, dt);
    this.pitchOffset = damp(this.pitchOffset, 0, 0.75, dt);

    this.applyShake(dt);
  }

  /** Side-on TV camera used for local versus so both humans read the pitch equally. */
  private updateBroadcast(dt: number, player: Footballer, ball: Ball, snapFactor: number): void {
    const b = ball.body.position;
    const speedZoom = clamp(ball.body.speed / 30, 0, 1);
    const spread = Math.abs(player.position.z - b.z);
    const dist = 21 + speedZoom * 2.4 + clamp(spread * 0.25, 0, 5);
    const desiredX = clamp(b.x * 0.25, -4, 4) - dist * 0.42;
    const desiredY = 12 + clamp(b.y * 0.5, 0, 4);
    const desiredZ = b.z * 0.62;
    const smooth = snapFactor > 0 ? snapFactor : 1 - Math.pow(0.0012, dt);
    this.pos.set(
      lerp(this.pos.x, desiredX, smooth),
      lerp(this.pos.y, desiredY, smooth),
      lerp(this.pos.z, desiredZ, smooth),
    );
    this.look.set(
      lerp(this.look.x, b.x * 0.55, smooth),
      lerp(this.look.y, 1 + b.y * 0.35, smooth),
      lerp(this.look.z, b.z * 0.82, smooth),
    );
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.fov = damp(this.camera.fov, this.fov + speedZoom * 3, 0.02, dt);
    this.camera.updateProjectionMatrix();
  }

  private applyShake(dt: number): void {
    if (this.shake <= 0.0001) return;
    const s = this.shake;
    const t = this.shakeTime * 34;
    this.camera.position.x += Math.sin(t * 1.7) * 0.16 * s;
    this.camera.position.y += Math.sin(t * 2.3 + 1.1) * 0.13 * s;
    this.camera.position.z += Math.sin(t * 1.9 + 2.4) * 0.16 * s;
    this.camera.rotation.z += Math.sin(t * 2.1) * 0.012 * s;
    this.shake = Math.max(0, this.shake - dt * 3.1);
  }
}
