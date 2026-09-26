import * as THREE from 'three';
import type { Cosmetics } from './characterDefs.ts';
import { clamp, damp, lerp } from '../core/math.ts';

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
  };
}

/**
 * Procedural, original character rig. No imported animations - every pose is
 * computed from gameplay state, which keeps it reactive and tiny.
 */
export class CharacterRig {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private torso!: THREE.Mesh;
  private headGroup = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private hair: THREE.Object3D | null = null;
  private accessory: THREE.Object3D | null = null;
  private shadow!: THREE.Mesh;
  private chargeGlow!: THREE.Mesh;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private stride = 0;
  private bodyTilt = 0;
  private bodyRoll = 0;
  private cos: Cosmetics;
  /** Where the kicking foot currently is, in world space. */
  readonly footWorld = new THREE.Vector3();

  constructor(cosmetics: Cosmetics) {
    this.cos = cosmetics;
    this.build();
  }

  private mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...opts });
    this.materials.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private build(): void {
    const c = this.cos;
    const skinMat = this.mat(c.skin);
    const shirtMat = this.mat(c.shirt, { roughness: 0.68 });
    const shortsMat = this.mat(c.shorts, { roughness: 0.8 });
    const shoeMat = this.mat(c.shoes, { roughness: 0.5, metalness: 0.1 });

    this.root.add(this.body);

    // Torso.
    this.torso = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.235, 0.34, 4, 12)), shirtMat);
    this.torso.position.y = 1.08;
    this.torso.castShadow = true;
    this.body.add(this.torso);

    // Shoulder yoke for a slightly toy-like silhouette.
    const yoke = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.25, 12, 10)), shirtMat);
    yoke.scale.set(1.25, 0.6, 0.85);
    yoke.position.y = 1.26;
    yoke.castShadow = true;
    this.body.add(yoke);

    // Hips / shorts.
    const hips = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.215, 0.14, 4, 12)), shortsMat);
    hips.position.y = 0.83;
    hips.castShadow = true;
    this.body.add(hips);

    // Head.
    this.headGroup.position.y = 1.45;
    this.body.add(this.headGroup);
    const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.215, 16, 14)), skinMat);
    head.scale.set(1, 1.08, 0.97);
    head.castShadow = true;
    this.headGroup.add(head);

    // Eyes (simple, readable, original).
    const eyeMat = this.mat(0x1a1c22, { roughness: 0.3 });
    const eyeGeo = this.geo(new THREE.SphereGeometry(0.038, 8, 8));
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx * 0.082, 0.02, 0.196);
      this.headGroup.add(eye);
    }

    this.buildHair();
    this.buildAccessory();

    // Arms.
    const armGeo = this.geo(new THREE.CapsuleGeometry(0.072, 0.34, 4, 8));
    for (const [pivot, sx] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as [THREE.Group, number][]) {
      pivot.position.set(sx * 0.295, 1.26, 0);
      const arm = new THREE.Mesh(armGeo, skinMat);
      arm.position.y = -0.23;
      arm.castShadow = true;
      pivot.add(arm);
      const sleeve = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.085, 0.1, 3, 8)), shirtMat);
      sleeve.position.y = -0.08;
      pivot.add(sleeve);
      this.body.add(pivot);
    }

    // Legs.
    const thighGeo = this.geo(new THREE.CapsuleGeometry(0.095, 0.3, 4, 8));
    const shinGeo = this.geo(new THREE.CapsuleGeometry(0.082, 0.28, 4, 8));
    const shoeGeo = this.geo(new THREE.BoxGeometry(0.16, 0.1, 0.27));
    for (const [pivot, sx] of [
      [this.legL, -1],
      [this.legR, 1],
    ] as [THREE.Group, number][]) {
      pivot.position.set(sx * 0.115, 0.82, 0);
      const thigh = new THREE.Mesh(thighGeo, shortsMat);
      thigh.position.y = -0.2;
      thigh.castShadow = true;
      pivot.add(thigh);
      const shin = new THREE.Mesh(shinGeo, skinMat);
      shin.position.y = -0.56;
      shin.castShadow = true;
      pivot.add(shin);
      const shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shoe.position.set(0, -0.76, 0.045);
      shoe.castShadow = true;
      pivot.add(shoe);
      this.body.add(pivot);
    }

    // Contact shadow blob (readability for aerials).
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.materials.push(shadowMat);
    this.shadow = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.42, 18)), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.015;
    this.root.add(this.shadow);

    // Charge glow ring at the feet.
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(glowMat);
    this.chargeGlow = new THREE.Mesh(this.geo(new THREE.RingGeometry(0.44, 0.62, 24)), glowMat);
    this.chargeGlow.rotation.x = -Math.PI / 2;
    this.chargeGlow.position.y = 0.03;
    this.root.add(this.chargeGlow);
  }

  private buildHair(): void {
    const c = this.cos;
    if (c.hairStyle === 'bald') return;
    const hairMat = this.mat(c.hairColor, { roughness: 0.85 });
    const g = new THREE.Group();
    switch (c.hairStyle) {
      case 'spiky': {
        const spikeGeo = this.geo(new THREE.ConeGeometry(0.06, 0.18, 6));
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const s = new THREE.Mesh(spikeGeo, hairMat);
          s.position.set(Math.cos(a) * 0.11, 0.2 - Math.abs(Math.sin(a)) * 0.02, Math.sin(a) * 0.09);
          s.rotation.z = -Math.cos(a) * 0.5;
          s.rotation.x = Math.sin(a) * 0.5;
          g.add(s);
        }
        break;
      }
      case 'bun': {
        const cap = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.22, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), hairMat);
        cap.position.y = 0.01;
        g.add(cap);
        const bun = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.1, 10, 8)), hairMat);
        bun.position.set(0, 0.11, -0.2);
        g.add(bun);
        break;
      }
      case 'curls': {
        const puffGeo = this.geo(new THREE.SphereGeometry(0.1, 8, 8));
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const p = new THREE.Mesh(puffGeo, hairMat);
          p.position.set(Math.cos(a) * 0.16, 0.1 + Math.sin(i * 2.1) * 0.05, Math.sin(a) * 0.15);
          g.add(p);
        }
        const top = new THREE.Mesh(puffGeo, hairMat);
        top.position.y = 0.2;
        top.scale.setScalar(1.3);
        g.add(top);
        break;
      }
      case 'mohawk': {
        const stripGeo = this.geo(new THREE.BoxGeometry(0.07, 0.19, 0.38));
        const strip = new THREE.Mesh(stripGeo, hairMat);
        strip.position.y = 0.19;
        g.add(strip);
        break;
      }
      default: {
        const cap = new THREE.Mesh(
          this.geo(new THREE.SphereGeometry(0.222, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.6)),
          hairMat,
        );
        cap.position.y = 0.01;
        cap.scale.set(1, 1.05, 1);
        g.add(cap);
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
        const band = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.2, 0.032, 6, 16)), accMat);
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.07;
        g.add(band);
        break;
      }
      case 'cap': {
        const cap = new THREE.Mesh(
          this.geo(new THREE.SphereGeometry(0.23, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)),
          accMat,
        );
        cap.position.y = 0.04;
        g.add(cap);
        const brim = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.28, 0.03, 0.18)), accMat);
        brim.position.set(0, 0.04, 0.2);
        g.add(brim);
        break;
      }
      case 'visor': {
        const visor = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.34, 0.09, 0.05)), accMat);
        visor.position.set(0, 0.05, 0.19);
        g.add(visor);
        break;
      }
      case 'scarf': {
        const scarf = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.17, 0.05, 6, 14)), accMat);
        scarf.rotation.x = Math.PI / 2;
        scarf.position.y = -0.21;
        g.add(scarf);
        break;
      }
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.accessory = g;
    this.headGroup.add(g);
  }

  setCosmetics(c: Cosmetics): void {
    this.cos = c;
    // Rebuild the pieces that depend on cosmetics.
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
    this.body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
    });
    // Recolour shared materials.
    const m = this.materials;
    (m[0] as THREE.MeshStandardMaterial).color.setHex(c.skin);
    (m[1] as THREE.MeshStandardMaterial).color.setHex(c.shirt);
    (m[2] as THREE.MeshStandardMaterial).color.setHex(c.shorts);
    (m[3] as THREE.MeshStandardMaterial).color.setHex(c.shoes);
  }

  update(dt: number, pose: RigPose, groundY: number): void {
    const speedRatio = clamp(pose.speed / Math.max(2, pose.maxSpeed), 0, 1.4);
    const airborne = !pose.grounded;

    // Stride cycle.
    const strideSpeed = lerp(6.5, 15.5, clamp(speedRatio, 0, 1));
    if (pose.grounded && pose.slide < 0.5) this.stride += dt * strideSpeed * (0.35 + speedRatio);
    const swing = Math.sin(this.stride) * (0.25 + speedRatio * 0.95);
    const swingB = Math.sin(this.stride + Math.PI) * (0.25 + speedRatio * 0.95);

    // Base leg/arm swing.
    let legLX = swing;
    let legRX = swingB;
    let armLX = swingB * 0.75;
    let armRX = swing * 0.75;

    if (airborne) {
      const up = clamp(pose.verticalVelocity / 7, -1, 1);
      legLX = lerp(0.35, -0.5, (up + 1) / 2);
      legRX = lerp(0.55, -0.25, (up + 1) / 2);
      armLX = -1.1 - up * 0.4;
      armRX = -1.1 - up * 0.4;
    }

    // Kick swing overrides the kicking leg.
    if (pose.kickSwing > 0) {
      const t = 1 - pose.kickSwing; // 0 -> 1 across the swing
      const curve = t < 0.32 ? -lerp(0, 1.35, t / 0.32) : lerp(-1.35, 1.25, (t - 0.32) / 0.68);
      if (pose.kickLeg > 0) legRX = curve;
      else legLX = curve;
      armLX = pose.kickLeg > 0 ? -curve * 0.6 : curve * 0.35;
      armRX = pose.kickLeg > 0 ? curve * 0.35 : -curve * 0.6;
    }

    // Wind-up during charge.
    if (pose.charge > 0.02 && pose.kickSwing <= 0) {
      const windup = pose.charge * 0.85;
      if (pose.kickLeg > 0) legRX = -windup;
      else legLX = -windup;
      armLX = windup * 0.5;
      armRX = -windup * 0.5;
    }

    if (pose.tackle > 0.01) {
      armLX = lerp(armLX, -1.6, pose.tackle);
      armRX = lerp(armRX, -1.6, pose.tackle);
      legLX = lerp(legLX, 0.6, pose.tackle);
    }

    if (pose.stumble > 0.01) {
      armLX = lerp(armLX, -2.4, pose.stumble);
      armRX = lerp(armRX, -2.0, pose.stumble);
    }

    // Celebrations.
    if (pose.celebration) {
      const t = pose.celebrationTime;
      switch (pose.celebration) {
        case 'jump':
          this.body.position.y = Math.abs(Math.sin(t * 7)) * 0.42;
          armLX = -2.6;
          armRX = -2.6;
          break;
        case 'spin':
          this.body.rotation.y += dt * 11;
          armLX = -1.5;
          armRX = -1.5;
          break;
        case 'fistpump':
          armRX = -2.4 + Math.sin(t * 13) * 0.55;
          armLX = 0.3;
          break;
        case 'slide':
          this.body.position.y = 0;
          break;
        case 'dance':
          this.body.position.y = Math.abs(Math.sin(t * 9)) * 0.14;
          this.bodyRoll = Math.sin(t * 6) * 0.35;
          armLX = -1.2 + Math.sin(t * 9) * 0.9;
          armRX = -1.2 - Math.sin(t * 9) * 0.9;
          break;
        case 'point':
          armRX = -1.45;
          armLX = 0.2;
          break;
      }
      if (pose.celebration !== 'spin') this.body.rotation.y = damp(this.body.rotation.y, 0, 0.0001, dt);
    } else {
      this.body.position.y = damp(this.body.position.y, 0, 0.0001, dt);
      this.body.rotation.y = damp(this.body.rotation.y, 0, 0.0001, dt);
    }

    this.legL.rotation.x = damp(this.legL.rotation.x, legLX, 0.00005, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, legRX, 0.00005, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, armLX, 0.0002, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armRX, 0.0002, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, 0.18 + speedRatio * 0.1, 0.001, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, -0.18 - speedRatio * 0.1, 0.001, dt);

    // Body lean: forward from acceleration, sideways from turning, flat in a slide.
    const targetTilt = pose.slide > 0.5 ? -1.15 : clamp(pose.leanZ * 0.28 + speedRatio * 0.14, -0.5, 0.5);
    const targetRoll = pose.slide > 0.5 ? 0.35 : clamp(-pose.leanX * 0.3, -0.45, 0.45) + this.bodyRoll;
    this.bodyTilt = damp(this.bodyTilt, targetTilt, 0.0005, dt);
    this.body.rotation.x = this.bodyTilt;
    this.body.rotation.z = damp(this.body.rotation.z, targetRoll, 0.0008, dt);
    this.bodyRoll *= 0.9;

    // Sliding drops the whole body towards the turf.
    const slideDrop = pose.slide * 0.52;
    this.body.position.z = -slideDrop * 0.35;
    this.body.scale.y = 1;
    this.root.position.y = Math.max(this.root.position.y, groundY);

    // Head keeps looking roughly forward/at the action.
    this.headGroup.rotation.x = -this.bodyTilt * 0.65;

    // Shadow.
    const height = Math.max(0, this.root.position.y - groundY);
    const shadowScale = clamp(1 - height * 0.12, 0.35, 1);
    this.shadow.scale.setScalar(shadowScale);
    this.shadow.position.y = groundY + 0.02 - this.root.position.y;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * shadowScale;

    // Charge ring.
    const glowMat = this.chargeGlow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = pose.charge * 0.75;
    const pulse = 1 + Math.sin(performance.now() * 0.02) * 0.06 * pose.charge;
    this.chargeGlow.scale.setScalar((0.7 + pose.charge * 0.7) * pulse);
    glowMat.color.setHSL(lerp(0.16, 0.0, pose.charge), 1, lerp(0.62, 0.52, pose.charge));
    this.chargeGlow.position.y = groundY + 0.04 - this.root.position.y;

    // Track the kicking foot for VFX.
    const legPivot = pose.kickLeg > 0 ? this.legR : this.legL;
    legPivot.getWorldPosition(this.footWorld);
    this.footWorld.y -= 0.6;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
