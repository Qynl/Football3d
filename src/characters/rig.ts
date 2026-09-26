import * as THREE from 'three';
import type { Cosmetics } from './characterDefs.ts';
import { clamp, clamp01, damp, lerp } from '../core/math.ts';

export interface RigPose {
  speed: number;
  maxSpeed: number;
  grounded: boolean;
  verticalVelocity: number;
  /** 0..1 slide blend. */
  slide: number;
  /** 0..1 kick charge. */
  charge: number;
  /** Counts down 1 -> 0 during a kick swing. */
  kickSwing: number;
  kickLeg: number;
  /** 0..1 tackle lunge blend. */
  tackle: number;
  /** 0..1 stagger blend. */
  stumble: number;
  /** Current celebration id, or null. */
  celebration: string | null;
  celebrationTime: number;
  /** Lean amount from acceleration (-1..1 sideways, -1..1 forward). */
  leanX: number;
  leanZ: number;
  /** Movement direction relative to facing: 1 = running forward, -1 = backpedal. */
  driveZ: number;
  /** Sideways movement relative to facing (-1 left, 1 right). */
  driveX: number;
  /** World point the head glances at (usually the ball). */
  lookX: number;
  lookY: number;
  lookZ: number;
}

export function createPose(): RigPose {
  return {
    speed: 0,
    maxSpeed: 8,
    grounded: true,
    verticalVelocity: 0,
    slide: 0,
    charge: 0,
    kickSwing: 0,
    kickLeg: 1,
    tackle: 0,
    stumble: 0,
    celebration: null,
    celebrationTime: 0,
    leanX: 0,
    leanZ: 0,
    driveZ: 0,
    driveX: 0,
    lookX: 0,
    lookY: 0.2,
    lookZ: 0,
  };
}

// Skeleton proportions (metres). Feet sit on y = 0.
const HIP_Y = 0.84;
const THIGH = 0.38;
const SHIN = 0.36;
const ANKLE_Y = 0.1;
const HIP_HALF = 0.115;
const CHEST_Y = 0.24; // above the hip pivot
const SHOULDER_Y = 0.46; // above the hip pivot
const SHOULDER_HALF = 0.235;
const UPPER_ARM = 0.26;
const FOREARM = 0.25;

/**
 * Procedural, original character rig. No imported animations and no skinning -
 * it is a small joint hierarchy (hips, chest, neck, two-bone arms and two-bone
 * legs) posed every frame from gameplay state.
 *
 * The legs are driven by inverse kinematics: the gait picks where each foot
 * should be and the hip/knee angles are solved from that, so feet plant on the
 * ground instead of skating and knees bend the way knees actually bend.
 */
export class CharacterRig {
  readonly root = new THREE.Group();
  /** Whole-body transform: bob, lean, squash. */
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private headGroup = new THREE.Group();
  private torso!: THREE.Mesh;
  private shoulderL = new THREE.Group();
  private shoulderR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private footL = new THREE.Group();
  private footR = new THREE.Group();
  private hair: THREE.Object3D | null = null;
  private accessory: THREE.Object3D | null = null;
  private shadow!: THREE.Mesh;
  private chargeGlow!: THREE.Mesh;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  // Animation state.
  private phase = Math.random() * Math.PI * 2;
  private bodyTilt = 0;
  private bodyRoll = 0;
  private bodyYaw = 0;
  private squash = 0;
  private bodyLift = 0;
  private wasGrounded = true;
  private airTime = 0;
  private breath = Math.random() * Math.PI * 2;
  private headYaw = 0;
  private headPitch = 0;
  private cos: Cosmetics;
  /** Where the kicking foot currently is, in world space. */
  readonly footWorld = new THREE.Vector3();

  constructor(cosmetics: Cosmetics) {
    this.cos = cosmetics;
    this.build();
  }

  private mat(
    color: number,
    opts: Partial<THREE.MeshStandardMaterialParameters> = {},
  ): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...opts });
    this.materials.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private add(parent: THREE.Object3D, mesh: THREE.Mesh): THREE.Mesh {
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private build(): void {
    const c = this.cos;
    const skinMat = this.mat(c.skin, { roughness: 0.82 });
    const shirtMat = this.mat(c.shirt, { roughness: 0.66 });
    const shortsMat = this.mat(c.shorts, { roughness: 0.8 });
    const shoeMat = this.mat(c.shoes, { roughness: 0.42, metalness: 0.12 });
    const sockMat = this.mat(0xf2f5fa, { roughness: 0.85 });
    const trimMat = this.mat(c.shorts, { roughness: 0.6 });

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = HIP_Y;
    this.hips.add(this.chest);
    this.chest.position.y = CHEST_Y;

    // ---- Pelvis / shorts -----------------------------------------------
    const pelvis = this.add(
      this.hips,
      new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.195, 0.14, 4, 14)), shortsMat),
    );
    pelvis.scale.set(1.08, 1, 0.84);
    pelvis.position.y = -0.06;

    // ---- Torso ----------------------------------------------------------
    this.torso = this.add(
      this.chest,
      new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.212, 0.42, 5, 16)), shirtMat),
    );
    this.torso.scale.set(1.08, 1, 0.78);
    this.torso.position.y = 0.02;
    // Chest taper / shoulder yoke.
    const yoke = this.add(
      this.chest,
      new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.235, 16, 12)), shirtMat),
    );
    yoke.scale.set(1.24, 0.58, 0.82);
    yoke.position.y = SHOULDER_Y - CHEST_Y;
    // Shirt hem trim, reads as a kit detail.
    const hem = this.add(
      this.chest,
      new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.212, 0.212, 0.05, 16)), trimMat),
    );
    hem.scale.set(1.06, 1, 0.82);
    hem.position.y = -0.21;

    // ---- Neck + head ----------------------------------------------------
    this.neck.position.y = SHOULDER_Y - CHEST_Y + 0.04;
    this.chest.add(this.neck);
    const neckMesh = this.add(
      this.neck,
      new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 10)), skinMat),
    );
    neckMesh.position.y = 0.02;
    this.neck.add(this.headGroup);
    this.headGroup.position.y = 0.2;
    const head = this.add(
      this.headGroup,
      new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.19, 18, 16)), skinMat),
    );
    head.scale.set(1, 1.12, 0.98);
    // Ears.
    const earGeo = this.geo(new THREE.SphereGeometry(0.045, 8, 8));
    for (const sx of [-1, 1]) {
      const ear = this.add(this.headGroup, new THREE.Mesh(earGeo, skinMat));
      ear.position.set(sx * 0.18, 0.0, -0.01);
      ear.scale.set(0.6, 1, 0.8);
    }
    // Eyes: whites plus pupils, so the face reads at a distance.
    const whiteMat = this.mat(0xf7f9ff, { roughness: 0.25 });
    const pupilMat = this.mat(0x151820, { roughness: 0.2 });
    const whiteGeo = this.geo(new THREE.SphereGeometry(0.052, 10, 10));
    const pupilGeo = this.geo(new THREE.SphereGeometry(0.026, 8, 8));
    for (const sx of [-1, 1]) {
      const w = this.add(this.headGroup, new THREE.Mesh(whiteGeo, whiteMat));
      w.position.set(sx * 0.076, 0.0, 0.166);
      w.scale.set(1, 1.15, 0.7);
      const p = this.add(this.headGroup, new THREE.Mesh(pupilGeo, pupilMat));
      p.position.set(sx * 0.08, -0.003, 0.192);
    }
    // Brow line gives the face a determined look instead of a blank stare.
    const browMat = this.mat(c.hairColor, { roughness: 0.9 });
    for (const sx of [-1, 1]) {
      const brow = this.add(
        this.headGroup,
        new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.085, 0.022, 0.03)), browMat),
      );
      brow.position.set(sx * 0.078, 0.06, 0.172);
      brow.rotation.z = sx * 0.18;
    }

    this.buildHair();
    this.buildAccessory();

    // ---- Arms ------------------------------------------------------------
    const upperGeo = this.geo(new THREE.CapsuleGeometry(0.062, UPPER_ARM - 0.06, 4, 10));
    const foreGeo = this.geo(new THREE.CapsuleGeometry(0.052, FOREARM - 0.08, 4, 10));
    const handGeo = this.geo(new THREE.SphereGeometry(0.062, 10, 8));
    const sleeveGeo = this.geo(new THREE.CylinderGeometry(0.084, 0.075, 0.12, 12));
    for (const [shoulder, elbow, sx] of [
      [this.shoulderL, this.elbowL, -1],
      [this.shoulderR, this.elbowR, 1],
    ] as [THREE.Group, THREE.Group, number][]) {
      shoulder.position.set(sx * SHOULDER_HALF, SHOULDER_Y - CHEST_Y, 0);
      this.chest.add(shoulder);
      const sleeve = this.add(shoulder, new THREE.Mesh(sleeveGeo, shirtMat));
      sleeve.position.y = -0.045;
      const upper = this.add(shoulder, new THREE.Mesh(upperGeo, skinMat));
      upper.position.y = -UPPER_ARM / 2;
      elbow.position.y = -UPPER_ARM;
      shoulder.add(elbow);
      const fore = this.add(elbow, new THREE.Mesh(foreGeo, skinMat));
      fore.position.y = -FOREARM / 2;
      const hand = this.add(elbow, new THREE.Mesh(handGeo, skinMat));
      hand.position.y = -FOREARM - 0.03;
      hand.scale.set(0.9, 1.1, 0.7);
    }

    // ---- Legs ------------------------------------------------------------
    const thighGeo = this.geo(new THREE.CapsuleGeometry(0.088, THIGH - 0.1, 4, 10));
    const shinGeo = this.geo(new THREE.CapsuleGeometry(0.068, SHIN - 0.12, 4, 10));
    const sockGeo = this.geo(new THREE.CylinderGeometry(0.075, 0.066, 0.17, 10));
    const shortLegGeo = this.geo(new THREE.CylinderGeometry(0.108, 0.094, 0.22, 12));
    const shoeGeo = this.geo(new THREE.BoxGeometry(0.115, 0.075, 0.2));
    const toeGeo = this.geo(new THREE.SphereGeometry(0.058, 10, 8));
    for (const [hip, knee, foot, sx] of [
      [this.hipL, this.kneeL, this.footL, -1],
      [this.hipR, this.kneeR, this.footR, 1],
    ] as [THREE.Group, THREE.Group, THREE.Group, number][]) {
      hip.position.set(sx * HIP_HALF, -0.02, 0);
      this.hips.add(hip);
      const shortLeg = this.add(hip, new THREE.Mesh(shortLegGeo, shortsMat));
      shortLeg.position.y = -0.11;
      shortLeg.scale.set(1, 1, 0.85);
      const thigh = this.add(hip, new THREE.Mesh(thighGeo, skinMat));
      thigh.position.y = -THIGH / 2;
      knee.position.y = -THIGH;
      hip.add(knee);
      const shin = this.add(knee, new THREE.Mesh(shinGeo, skinMat));
      shin.position.y = -SHIN / 2 - 0.02;
      const sock = this.add(knee, new THREE.Mesh(sockGeo, sockMat));
      sock.position.y = -SHIN + 0.08;
      foot.position.y = -SHIN;
      knee.add(foot);
      const shoe = this.add(foot, new THREE.Mesh(shoeGeo, shoeMat));
      shoe.position.set(0, -0.035, 0.035);
      const toe = this.add(foot, new THREE.Mesh(toeGeo, shoeMat));
      toe.position.set(0, -0.032, 0.125);
      toe.scale.set(1, 0.62, 0.85);
    }

    // ---- Contact shadow + charge ring ------------------------------------
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x0a1a10,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.materials.push(shadowMat);
    this.shadow = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.4, 20)), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.015;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(glowMat);
    this.chargeGlow = new THREE.Mesh(this.geo(new THREE.RingGeometry(0.44, 0.62, 28)), glowMat);
    this.chargeGlow.rotation.x = -Math.PI / 2;
    this.chargeGlow.position.y = 0.03;
    this.chargeGlow.renderOrder = 2;
    this.root.add(this.chargeGlow);
  }

  private buildHair(): void {
    const c = this.cos;
    if (c.hairStyle === 'bald') return;
    const hairMat = this.mat(c.hairColor, { roughness: 0.88 });
    const g = new THREE.Group();
    switch (c.hairStyle) {
      case 'spiky': {
        const cap = new THREE.Mesh(
          this.geo(new THREE.SphereGeometry(0.196, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.42)),
          hairMat,
        );
        cap.position.y = 0.035;
        g.add(cap);
        const spikeGeo = this.geo(new THREE.ConeGeometry(0.055, 0.17, 6));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const s = new THREE.Mesh(spikeGeo, hairMat);
          s.position.set(Math.cos(a) * 0.1, 0.17 - Math.abs(Math.sin(a)) * 0.015, Math.sin(a) * 0.085);
          s.rotation.z = -Math.cos(a) * 0.55;
          s.rotation.x = Math.sin(a) * 0.55;
          g.add(s);
        }
        break;
      }
      case 'bun': {
        const cap = new THREE.Mesh(
          this.geo(new THREE.SphereGeometry(0.198, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.46)),
          hairMat,
        );
        cap.position.y = 0.03;
        g.add(cap);
        const bun = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.095, 12, 10)), hairMat);
        bun.position.set(0, 0.1, -0.2);
        g.add(bun);
        break;
      }
      case 'curls': {
        const puffGeo = this.geo(new THREE.SphereGeometry(0.095, 10, 8));
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * Math.PI * 2;
          const p = new THREE.Mesh(puffGeo, hairMat);
          p.position.set(Math.cos(a) * 0.15, 0.11 + Math.sin(i * 2.1) * 0.04, Math.sin(a) * 0.135);
          g.add(p);
        }
        const top = new THREE.Mesh(puffGeo, hairMat);
        top.position.y = 0.185;
        top.scale.setScalar(1.35);
        g.add(top);
        break;
      }
      case 'mohawk': {
        const cap = new THREE.Mesh(
          this.geo(new THREE.SphereGeometry(0.195, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.42)),
          hairMat,
        );
        cap.position.y = 0.035;
        cap.scale.set(1, 0.7, 1);
        g.add(cap);
        for (let i = 0; i < 5; i++) {
          const fin = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.05, 0.16 + (i === 2 ? 0.06 : 0), 4)), hairMat);
          fin.position.set(0, 0.18, 0.13 - i * 0.065);
          g.add(fin);
        }
        break;
      }
      default: {
        const cap = new THREE.Mesh(
          this.geo(new THREE.SphereGeometry(0.197, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.5)),
          hairMat,
        );
        cap.position.y = 0.025;
        cap.scale.set(1, 1.05, 1.02);
        g.add(cap);
        // Sideburns keep the hairline from looking like a swim cap.
        for (const sx of [-1, 1]) {
          const side = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.035, 0.09, 0.1)), hairMat);
          side.position.set(sx * 0.175, -0.015, -0.01);
          g.add(side);
        }
      }
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.hair = g;
    this.headGroup.add(g);
  }

  private buildAccessory(): void {
    const c = this.cos;
    if (c.accessory === 'none') return;
    const accMat = this.mat(c.accessory === 'scarf' ? c.shirt : 0xf5f7fa, { roughness: 0.6 });
    const g = new THREE.Group();
    switch (c.accessory) {
      case 'headband': {
        const band = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.195, 0.03, 8, 18)), accMat);
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.07;
        band.scale.set(1, 1, 1.1);
        g.add(band);
        break;
      }
      case 'cap': {
        const cap = new THREE.Mesh(
          this.geo(new THREE.SphereGeometry(0.222, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)),
          accMat,
        );
        cap.position.y = 0.045;
        g.add(cap);
        const brim = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.26, 0.028, 0.17)), accMat);
        brim.position.set(0, 0.045, 0.2);
        brim.rotation.x = -0.12;
        g.add(brim);
        break;
      }
      case 'visor': {
        const band = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.2, 0.026, 8, 18)), accMat);
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.075;
        g.add(band);
        const brim = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.28, 0.025, 0.16)), accMat);
        brim.position.set(0, 0.075, 0.19);
        brim.rotation.x = -0.1;
        g.add(brim);
        break;
      }
      case 'scarf': {
        const scarf = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.155, 0.048, 8, 16)), accMat);
        scarf.rotation.x = Math.PI / 2;
        scarf.position.y = -0.19;
        g.add(scarf);
        const tail = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.1, 0.22, 0.05)), accMat);
        tail.position.set(0.1, -0.3, -0.12);
        g.add(tail);
        break;
      }
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.accessory = g;
    this.headGroup.add(g);
  }

  setCosmetics(c: Cosmetics): void {
    this.cos = c;
    if (this.hair) {
      this.headGroup.remove(this.hair);
      this.hair = null;
    }
    if (this.accessory) {
      this.headGroup.remove(this.accessory);
      this.accessory = null;
    }
    this.buildHair();
    this.buildAccessory();
    const m = this.materials as THREE.MeshStandardMaterial[];
    m[0]!.color.setHex(c.skin);
    m[1]!.color.setHex(c.shirt);
    m[2]!.color.setHex(c.shorts);
    m[3]!.color.setHex(c.shoes);
    m[5]!.color.setHex(c.shorts); // hem trim
  }

  // ------------------------------------------------------------------- pose

  /**
   * Two-bone IK. Places the ankle of one leg at a target expressed relative to
   * the hip joint, then orients the foot flat-ish to the ground.
   */
  private solveLeg(
    hip: THREE.Group,
    knee: THREE.Group,
    foot: THREE.Group,
    targetZ: number,
    targetY: number,
    targetX: number,
    footPitch: number,
    dt: number,
  ): void {
    // Vector from the hip joint down to the ankle target (hip-local space).
    const dz = targetZ;
    const dy = targetY;
    const dx = targetX;
    const reach = (THIGH + SHIN) * 0.995;
    let d = Math.hypot(dx, dy, dz);
    if (d > reach) {
      const k = reach / d;
      d = reach;
      hip.rotation.z = damp(hip.rotation.z, Math.atan2(dx * k, -dy * k), 0.0002, dt);
    } else {
      hip.rotation.z = damp(hip.rotation.z, Math.atan2(dx, -dy) * 0.8, 0.0002, dt);
    }
    d = Math.max(0.05, d);
    // Angle of the hip->ankle line from straight down, positive forwards.
    const lineAngle = Math.atan2(dz, Math.max(0.05, -dy));
    const cosAlpha = clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1);
    const alpha = Math.acos(cosAlpha);
    const cosKnee = clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1);
    const bend = Math.PI - Math.acos(cosKnee);
    hip.rotation.x = -(lineAngle + alpha);
    knee.rotation.x = bend;
    foot.rotation.x = -(hip.rotation.x + knee.rotation.x) + footPitch;
  }

  update(dt: number, pose: RigPose, groundY: number): void {
    const speedRatio = clamp(pose.speed / Math.max(2, pose.maxSpeed), 0, 1.35);
    const airborne = !pose.grounded;
    const sliding = pose.slide > 0.5;
    const backpedal = pose.driveZ < -0.25;

    // ---- Landing squash ---------------------------------------------------
    if (airborne) this.airTime += dt;
    if (pose.grounded && !this.wasGrounded) {
      this.squash = clamp01(this.airTime * 1.6 + Math.abs(pose.verticalVelocity) * 0.06);
      this.airTime = 0;
    }
    this.wasGrounded = pose.grounded;
    this.squash = damp(this.squash, 0, 0.0005, dt);

    // ---- Gait clock -------------------------------------------------------
    // Stride frequency rises with speed; stride length grows then saturates.
    const cadence = lerp(5.6, 13.4, clamp01(speedRatio)) * (backpedal ? 0.85 : 1);
    if (pose.grounded && !sliding) this.phase += dt * cadence * (0.45 + speedRatio * 0.9);
    this.phase %= Math.PI * 2;
    this.breath += dt * 1.9;

    const strideLen = lerp(0.12, 0.56, clamp01(speedRatio)) * (backpedal ? -0.7 : 1);
    const liftH = lerp(0.03, 0.3, clamp01(speedRatio));
    const moving = speedRatio > 0.06;

    // Foot targets for the walk/run cycle, in hip-local space.
    const legTarget = (offset: number): { z: number; y: number; lift: number } => {
      const p = this.phase + offset;
      const z = Math.cos(p) * strideLen;
      const swing = Math.sin(p) < 0; // back half of the cycle = foot in the air
      const lift = swing ? Math.abs(Math.sin(p)) * liftH : 0;
      return { z, y: -(HIP_Y - ANKLE_Y) + lift, lift };
    };
    const idleShift = Math.sin(this.breath * 0.7) * 0.012;
    let tL = moving ? legTarget(0) : { z: 0.02, y: -(HIP_Y - ANKLE_Y) + idleShift, lift: 0 };
    let tR = moving ? legTarget(Math.PI) : { z: -0.02, y: -(HIP_Y - ANKLE_Y) - idleShift, lift: 0 };

    // ---- Airborne: tuck up on the way up, reach on the way down -----------
    if (airborne) {
      const up = clamp(pose.verticalVelocity / 7, -1, 1);
      const tuck = lerp(0.22, -0.08, (up + 1) / 2);
      tL = { z: 0.12 + up * 0.12, y: -(HIP_Y - ANKLE_Y) + tuck + 0.1, lift: 0 };
      tR = { z: -0.06 - up * 0.1, y: -(HIP_Y - ANKLE_Y) + tuck, lift: 0 };
    }

    // ---- Kick: wind up, whip through, follow through ----------------------
    let kickBlend = 0;
    let kickHipTwist = 0;
    if (pose.kickSwing > 0) {
      const t = 1 - pose.kickSwing; // 0 -> 1 across the swing
      kickBlend = 1;
      // Leg travels from behind the body to well in front, fast through contact.
      const arc = t < 0.3 ? -0.55 * (t / 0.3) : lerp(-0.55, 0.62, Math.pow((t - 0.3) / 0.7, 0.65));
      const height = Math.sin(clamp01(t) * Math.PI) * 0.34;
      const kicking = { z: arc, y: -(HIP_Y - ANKLE_Y) + height, lift: height };
      const planted = { z: -0.12, y: -(HIP_Y - ANKLE_Y), lift: 0 };
      if (pose.kickLeg > 0) {
        tR = kicking;
        tL = planted;
      } else {
        tL = kicking;
        tR = planted;
      }
      kickHipTwist = -pose.kickLeg * Math.sin(t * Math.PI) * 0.35;
    } else if (pose.charge > 0.02) {
      // Wind-up: weight back, kicking leg cocked.
      const w = pose.charge;
      const cocked = { z: -0.16 - w * 0.3, y: -(HIP_Y - ANKLE_Y) + w * 0.16, lift: w * 0.16 };
      const planted = { z: 0.06, y: -(HIP_Y - ANKLE_Y), lift: 0 };
      if (pose.kickLeg > 0) {
        tR = cocked;
        tL = planted;
      } else {
        tL = cocked;
        tR = planted;
      }
      kickHipTwist = pose.kickLeg * w * 0.3;
    }

    // ---- Slide tackle -----------------------------------------------------
    if (pose.slide > 0.01) {
      const s = pose.slide;
      tL = {
        z: lerp(tL.z, 0.52, s),
        y: lerp(tL.y, -(HIP_Y - ANKLE_Y) + 0.34, s),
        lift: 0,
      };
      tR = {
        z: lerp(tR.z, -0.02, s),
        y: lerp(tR.y, -(HIP_Y - ANKLE_Y) + 0.42, s),
        lift: 0,
      };
    }

    // ---- Celebrations ------------------------------------------------------
    let armOverrideL: [number, number] | null = null;
    let armOverrideR: [number, number] | null = null;
    let bodyLift = 0;
    if (pose.celebration) {
      const t = pose.celebrationTime;
      switch (pose.celebration) {
        case 'jump': {
          const hop = Math.abs(Math.sin(t * 6.2));
          bodyLift = hop * 0.45;
          armOverrideL = [-2.5 - hop * 0.4, 0.2];
          armOverrideR = [-2.5 - hop * 0.4, 0.2];
          tL = { z: 0.05, y: -(HIP_Y - ANKLE_Y) + hop * 0.22, lift: 0 };
          tR = { z: -0.05, y: -(HIP_Y - ANKLE_Y) + hop * 0.26, lift: 0 };
          break;
        }
        case 'spin':
          this.bodyYaw += dt * 9;
          armOverrideL = [-1.45, 0.15];
          armOverrideR = [-1.45, 0.15];
          break;
        case 'fistpump':
          armOverrideR = [-2.5 + Math.sin(t * 12) * 0.5, 1.5];
          armOverrideL = [0.35, 0.5];
          break;
        case 'slide':
          tL = { z: 0.5, y: -(HIP_Y - ANKLE_Y) + 0.36, lift: 0 };
          tR = { z: -0.05, y: -(HIP_Y - ANKLE_Y) + 0.42, lift: 0 };
          break;
        case 'dance': {
          const d = Math.sin(t * 8);
          bodyLift = Math.abs(Math.sin(t * 8)) * 0.12;
          this.bodyRoll = d * 0.3;
          armOverrideL = [-1.1 + d * 0.9, 0.9];
          armOverrideR = [-1.1 - d * 0.9, 0.9];
          tL = { z: d * 0.2, y: -(HIP_Y - ANKLE_Y) + Math.max(0, d) * 0.12, lift: 0 };
          tR = { z: -d * 0.2, y: -(HIP_Y - ANKLE_Y) + Math.max(0, -d) * 0.12, lift: 0 };
          break;
        }
        case 'point':
          armOverrideR = [-1.4, 0.1];
          armOverrideL = [0.25, 0.7];
          break;
      }
    }

    // ---- Solve the legs ----------------------------------------------------
    const footPitchL = tL.lift > 0.02 ? -0.35 : sliding ? 0.3 : 0.05;
    const footPitchR = tR.lift > 0.02 ? -0.35 : sliding ? 0.3 : 0.05;
    this.solveLeg(this.hipL, this.kneeL, this.footL, tL.z, tL.y, -0.0, footPitchL, dt);
    this.solveLeg(this.hipR, this.kneeR, this.footR, tR.z, tR.y, 0.0, footPitchR, dt);

    // ---- Arms --------------------------------------------------------------
    // Opposite to the legs, with an elbow that bends more the faster you run.
    const armSwing = Math.sin(this.phase) * (0.3 + speedRatio * 1.05);
    let shoulderL = -armSwing;
    let shoulderR = armSwing;
    let elbowL = 0.32 + speedRatio * 0.85 + Math.max(0, -armSwing) * 0.5;
    let elbowR = 0.32 + speedRatio * 0.85 + Math.max(0, armSwing) * 0.5;
    if (airborne) {
      const up = clamp(pose.verticalVelocity / 7, -1, 1);
      shoulderL = -0.9 - up * 0.5;
      shoulderR = -0.9 - up * 0.5;
      elbowL = elbowR = 0.7;
    }
    if (kickBlend > 0) {
      // Counterbalance: the arm opposite the kicking leg swings out.
      const t = 1 - pose.kickSwing;
      const cb = Math.sin(t * Math.PI) * 1.3;
      if (pose.kickLeg > 0) {
        shoulderL = -cb;
        shoulderR = cb * 0.45;
      } else {
        shoulderR = -cb;
        shoulderL = cb * 0.45;
      }
      elbowL = elbowR = 0.5;
    }
    if (pose.tackle > 0.01) {
      shoulderL = lerp(shoulderL, -1.5, pose.tackle);
      shoulderR = lerp(shoulderR, -1.5, pose.tackle);
      elbowL = lerp(elbowL, 0.25, pose.tackle);
      elbowR = lerp(elbowR, 0.25, pose.tackle);
    }
    if (pose.slide > 0.01) {
      shoulderL = lerp(shoulderL, 0.9, pose.slide);
      shoulderR = lerp(shoulderR, 0.5, pose.slide);
      elbowL = lerp(elbowL, 0.9, pose.slide);
      elbowR = lerp(elbowR, 0.4, pose.slide);
    }
    if (pose.stumble > 0.01) {
      const flail = Math.sin(this.breath * 9) * 0.8;
      shoulderL = lerp(shoulderL, -2.3 + flail, pose.stumble);
      shoulderR = lerp(shoulderR, -2.1 - flail, pose.stumble);
      elbowL = lerp(elbowL, 0.3, pose.stumble);
      elbowR = lerp(elbowR, 0.3, pose.stumble);
    }
    if (armOverrideL) [shoulderL, elbowL] = armOverrideL;
    if (armOverrideR) [shoulderR, elbowR] = armOverrideR;

    const armSmooth = 0.00002;
    this.shoulderL.rotation.x = damp(this.shoulderL.rotation.x, shoulderL, armSmooth, dt);
    this.shoulderR.rotation.x = damp(this.shoulderR.rotation.x, shoulderR, armSmooth, dt);
    this.elbowL.rotation.x = damp(this.elbowL.rotation.x, elbowL, armSmooth, dt);
    this.elbowR.rotation.x = damp(this.elbowR.rotation.x, elbowR, armSmooth, dt);
    // Arms held slightly away from the body, more when sprinting.
    const spread = 0.16 + speedRatio * 0.14 + pose.charge * 0.1;
    this.shoulderL.rotation.z = damp(this.shoulderL.rotation.z, spread, 0.001, dt);
    this.shoulderR.rotation.z = damp(this.shoulderR.rotation.z, -spread, 0.001, dt);

    // ---- Torso / hips ------------------------------------------------------
    // Hips and shoulders counter-rotate as the legs swing - the single biggest
    // cue that separates a running character from a sliding statue.
    const twist = Math.sin(this.phase) * 0.16 * clamp01(speedRatio) + kickHipTwist;
    this.hips.rotation.y = damp(this.hips.rotation.y, -twist * 0.55, 0.0005, dt);
    this.chest.rotation.y = damp(this.chest.rotation.y, twist, 0.0005, dt);
    this.chest.rotation.x = damp(
      this.chest.rotation.x,
      sliding ? 0.5 : clamp(speedRatio * 0.12 + pose.charge * 0.1, 0, 0.3),
      0.0008,
      dt,
    );

    // Vertical bob: twice per stride, plus breathing at rest.
    const bob = moving
      ? Math.cos(this.phase * 2) * 0.022 * (0.4 + speedRatio)
      : Math.sin(this.breath) * 0.008;
    const hipDrop = moving ? -Math.abs(Math.sin(this.phase)) * 0.012 * speedRatio : 0;
    // NOTE: assign, never accumulate - reading back body.position.y here and
    // subtracting again below would make the body sink a little every frame.
    this.bodyLift = damp(this.bodyLift, bodyLift - pose.slide * 0.3, 0.0002, dt);
    this.body.position.y = this.bodyLift + bob + hipDrop;

    // Lean: forward under acceleration, into the turn sideways, flat in a slide.
    const targetTilt = sliding
      ? -0.95
      : clamp(pose.leanZ * 0.22 + speedRatio * 0.16 + (backpedal ? -0.12 : 0), -0.45, 0.5);
    const targetRoll = sliding ? 0.32 : clamp(-pose.leanX * 0.26, -0.4, 0.4) + this.bodyRoll;
    this.bodyTilt = damp(this.bodyTilt, targetTilt, 0.0006, dt);
    this.body.rotation.x = this.bodyTilt;
    this.body.rotation.z = damp(this.body.rotation.z, targetRoll, 0.0009, dt);
    this.bodyRoll *= 0.88;
    // Crabbing: the body angles slightly towards the way it is travelling.
    const yawTarget = pose.celebration === 'spin' ? this.bodyYaw : clamp(pose.driveX, -1, 1) * 0.3;
    this.body.rotation.y = damp(this.body.rotation.y, yawTarget, 0.0006, dt);
    if (pose.celebration !== 'spin') this.bodyYaw = this.body.rotation.y;

    // Landing squash / breathing swell.
    const breathe = moving ? 0 : Math.sin(this.breath) * 0.012;
    this.body.scale.set(
      1 + this.squash * 0.12 + breathe * 0.4,
      1 - this.squash * 0.2,
      1 + this.squash * 0.12 + breathe,
    );
    // Sliding drops the whole body towards the turf.
    this.body.position.z = -pose.slide * 0.18;

    // ---- Head: glance at the ball -----------------------------------------
    const dxw = pose.lookX - this.root.position.x;
    const dzw = pose.lookZ - this.root.position.z;
    const dyw = pose.lookY - (this.root.position.y + 1.4);
    const localYaw = Math.atan2(dxw, dzw) - this.root.rotation.y;
    const wrapped = Math.atan2(Math.sin(localYaw), Math.cos(localYaw));
    const dist = Math.max(0.4, Math.hypot(dxw, dzw));
    this.headYaw = damp(this.headYaw, clamp(wrapped, -0.85, 0.85), 0.0008, dt);
    this.headPitch = damp(this.headPitch, clamp(-Math.atan2(dyw, dist), -0.45, 0.5), 0.0012, dt);
    this.neck.rotation.y = this.headYaw * 0.35;
    this.headGroup.rotation.y = this.headYaw * 0.65;
    this.headGroup.rotation.x = this.headPitch - this.bodyTilt * 0.6 - this.chest.rotation.x * 0.6;

    // ---- Ground props ------------------------------------------------------
    this.root.position.y = Math.max(this.root.position.y, groundY);
    const height = Math.max(0, this.root.position.y - groundY);
    const shadowScale = clamp(1 - height * 0.1, 0.4, 1);
    this.shadow.scale.setScalar(shadowScale);
    this.shadow.position.y = groundY + 0.02 - this.root.position.y;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.32 * shadowScale;

    const glowMat = this.chargeGlow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = pose.charge * 0.8;
    const pulse = 1 + Math.sin(this.breath * 9) * 0.06 * pose.charge;
    this.chargeGlow.scale.setScalar((0.7 + pose.charge * 0.7) * pulse);
    glowMat.color.setHSL(lerp(0.16, 0.0, pose.charge), 1, lerp(0.62, 0.52, pose.charge));
    this.chargeGlow.position.y = groundY + 0.04 - this.root.position.y;

    // Track the kicking foot for VFX and audio.
    (pose.kickLeg > 0 ? this.footR : this.footL).getWorldPosition(this.footWorld);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
