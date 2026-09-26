import * as THREE from 'three';
import { ParticleSystem } from './particles.ts';
import { clamp } from '../core/math.ts';

interface Shockwave {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
}

/** Facade over particles, shockwaves, hitstop and slow motion. */
export class Vfx {
  readonly group = new THREE.Group();
  readonly particles = new ParticleSystem();
  private waves: Shockwave[] = [];
  private wavePool: THREE.Mesh[] = [];
  private ringGeo: THREE.RingGeometry;
  /** Global time scale used by the game loop (hitstop / slow motion). */
  timeScale = 1;
  private hitstopTimer = 0;
  private slowmoTimer = 0;
  private slowmoScale = 1;
  grassColor = 0x49b45a;

  constructor() {
    this.group.add(this.particles.points);
    this.ringGeo = new THREE.RingGeometry(0.45, 0.62, 28);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.wavePool.push(mesh);
    }
  }

  hitstop(seconds: number): void {
    this.hitstopTimer = Math.max(this.hitstopTimer, seconds);
  }

  slowmo(scale: number, seconds: number): void {
    this.slowmoScale = scale;
    this.slowmoTimer = Math.max(this.slowmoTimer, seconds);
  }

  clearTimeEffects(): void {
    this.hitstopTimer = 0;
    this.slowmoTimer = 0;
    this.timeScale = 1;
  }

  /** Called with real (unscaled) dt. Returns the dt gameplay should use. */
  tickTime(dt: number): number {
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      this.timeScale = 0.02;
      return dt * this.timeScale;
    }
    if (this.slowmoTimer > 0) {
      this.slowmoTimer -= dt;
      this.timeScale = this.slowmoScale;
      return dt * this.timeScale;
    }
    this.timeScale = 1;
    return dt;
  }

  shockwave(x: number, y: number, z: number, color: number, maxScale = 3, life = 0.45, flat = true): void {
    const mesh = this.wavePool.pop();
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(x, y, z);
    mesh.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    mesh.scale.setScalar(0.3);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.waves.push({ mesh, life, maxLife: life, maxScale });
  }

  kickBurst(x: number, y: number, z: number, power: number, dirX: number, dirZ: number): void {
    const t = clamp(power / 34, 0, 1);
    this.particles.emit({
      x,
      y: y + 0.1,
      z,
      count: Math.round(6 + t * 16),
      color: this.grassColor,
      colorJitter: 0.25,
      speed: 2.5 + t * 6,
      spread: 0.9,
      upBias: 0.9,
      size: 0.1 + t * 0.06,
      life: 0.45,
      gravity: -14,
      drag: 1.4,
      dirX: -dirX * 0.5,
      dirZ: -dirZ * 0.5,
      bounce: true,
    });
    if (t > 0.45) {
      this.shockwave(x, y + 0.35, z, 0xfff3c4, 1.4 + t * 2.2, 0.32);
    }
  }

  slideDust(x: number, z: number, speed: number): void {
    this.particles.emit({
      x,
      y: 0.1,
      z,
      count: 2,
      color: this.grassColor,
      colorJitter: 0.3,
      speed: 1.4 + speed * 0.12,
      spread: 0.8,
      upBias: 1.1,
      size: 0.1,
      life: 0.5,
      gravity: -10,
      drag: 1.6,
      bounce: true,
    });
  }

  impact(x: number, y: number, z: number, strength: number, color = 0xffffff): void {
    this.particles.emit({
      x,
      y,
      z,
      count: Math.round(4 + strength * 3),
      color,
      colorJitter: 0.2,
      speed: 2 + strength * 1.6,
      spread: 1,
      upBias: 0.4,
      size: 0.09,
      life: 0.35,
      gravity: -10,
      drag: 1.8,
    });
  }

  goalExplosion(x: number, y: number, z: number, color: number): void {
    this.particles.emit({
      x,
      y: y + 0.5,
      z,
      count: 120,
      color,
      colorJitter: 0.6,
      speed: 9,
      speedJitter: 0.9,
      spread: 1,
      upBias: 1.2,
      size: 0.17,
      life: 1.5,
      gravity: -8,
      drag: 0.5,
      bounce: true,
    });
    this.shockwave(x, y + 0.4, z, color, 9, 0.75, false);
    this.shockwave(x, 0.05, z, color, 12, 0.9, true);
  }

  confetti(x: number, z: number, color: number): void {
    this.particles.emit({
      x,
      y: 7,
      z,
      count: 90,
      color,
      colorJitter: 0.9,
      speed: 2.5,
      spread: 6,
      upBias: 0,
      size: 0.15,
      life: 2.6,
      gravity: -3.4,
      drag: 0.35,
    });
  }

  update(dt: number): void {
    this.particles.update(dt);
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life -= dt;
      const t = 1 - w.life / w.maxLife;
      if (w.life <= 0) {
        w.mesh.visible = false;
        this.wavePool.push(w.mesh);
        this.waves.splice(i, 1);
        continue;
      }
      w.mesh.scale.setScalar(0.3 + t * w.maxScale);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
    }
  }

  clear(): void {
    this.particles.clear();
    for (const w of this.waves) {
      w.mesh.visible = false;
      this.wavePool.push(w.mesh);
    }
    this.waves.length = 0;
  }

  dispose(): void {
    this.particles.dispose();
    this.ringGeo.dispose();
    for (const m of this.wavePool) (m.material as THREE.Material).dispose();
  }
}
