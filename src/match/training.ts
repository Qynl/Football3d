import * as THREE from 'three';
import { Rng } from '../core/math.ts';
import type { Ball } from '../ball/ball.ts';
import type { Arena } from '../arenas/arena.ts';
import type { Vfx } from '../effects/vfx.ts';
import type { AudioEngine } from '../audio/audio.ts';

interface Target {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  radius: number;
  value: number;
  alive: boolean;
  phase: number;
}

/** Shooting range: floating targets, aerial targets and a running score. */
export class TrainingMode {
  readonly group = new THREE.Group();
  private targets: Target[] = [];
  private geo: THREE.TorusGeometry;
  private matNormal: THREE.MeshStandardMaterial;
  private matAir: THREE.MeshStandardMaterial;
  private rng = new Rng(9182);
  score = 0;
  best = 0;
  combo = 0;
  private comboTimer = 0;
  private time = 0;
  active = false;
  lastHitText = '';

  private arena: Arena;
  private vfx: Vfx;
  private audio: AudioEngine;

  constructor(arena: Arena, vfx: Vfx, audio: AudioEngine) {
    this.arena = arena;
    this.vfx = vfx;
    this.audio = audio;
    this.geo = new THREE.TorusGeometry(0.85, 0.12, 8, 24);
    this.matNormal = new THREE.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffb703,
      emissiveIntensity: 0.6,
      roughness: 0.4,
    });
    this.matAir = new THREE.MeshStandardMaterial({
      color: 0x74c0fc,
      emissive: 0x2f80ed,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    });
  }

  start(): void {
    this.active = true;
    this.score = 0;
    this.combo = 0;
    this.clear();
    for (let i = 0; i < 3; i++) this.spawn();
  }

  stop(): void {
    this.active = false;
    this.clear();
  }

  private clear(): void {
    for (const t of this.targets) this.group.remove(t.mesh);
    this.targets.length = 0;
  }

  private spawn(): void {
    const def = this.arena.def;
    const aerial = this.rng.chance(0.4);
    const x = this.rng.range(-def.halfWidth * 0.75, def.halfWidth * 0.75);
    const z = this.rng.range(def.halfLength * 0.15, def.halfLength * 0.85);
    const y = aerial ? this.rng.range(1.7, 3.2) : this.rng.range(0.5, 1.0);
    const mesh = new THREE.Mesh(this.geo, aerial ? this.matAir : this.matNormal);
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.atan2(-x, -z);
    const t: Target = {
      mesh,
      x,
      y,
      z,
      radius: 0.95,
      value: aerial ? 3 : 1,
      alive: true,
      phase: this.rng.range(0, 6),
    };
    this.targets.push(t);
    this.group.add(mesh);
  }

  update(dt: number, balls: Ball[]): void {
    if (!this.active) return;
    this.time += dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    for (const t of this.targets) {
      if (!t.alive) continue;
      t.mesh.position.y = t.y + Math.sin(this.time * 1.6 + t.phase) * 0.12;
      t.mesh.rotation.z += dt * 0.8;
      for (const ball of balls) {
        const b = ball.body.position;
        const d = Math.hypot(b.x - t.x, b.y - t.mesh.position.y, b.z - t.z);
        if (d < t.radius + ball.body.radius * 0.5) {
          this.hit(t, ball);
          break;
        }
      }
    }
    // Recycle dead targets.
    for (let i = this.targets.length - 1; i >= 0; i--) {
      if (!this.targets[i].alive) {
        this.group.remove(this.targets[i].mesh);
        this.targets.splice(i, 1);
        this.spawn();
      }
    }
  }

  private hit(t: Target, ball: Ball): void {
    t.alive = false;
    this.combo++;
    this.comboTimer = 4;
    const speedBonus = ball.body.speed > 22 ? 2 : 0;
    const gained = t.value + speedBonus + Math.max(0, this.combo - 1);
    this.score += gained;
    this.best = Math.max(this.best, this.score);
    this.lastHitText = `+${gained}${this.combo > 1 ? ` (x${this.combo})` : ''}${speedBonus ? ' POWER' : ''}`;
    this.vfx.shockwave(t.x, t.mesh.position.y, t.z, t.value > 1 ? 0x74c0fc : 0xffe066, 3, 0.5, false);
    this.vfx.particles.emit({
      x: t.x,
      y: t.mesh.position.y,
      z: t.z,
      count: 26,
      color: t.value > 1 ? 0x74c0fc : 0xffe066,
      colorJitter: 0.3,
      speed: 5,
      spread: 1,
      upBias: 0.3,
      size: 0.14,
      life: 0.8,
      gravity: -7,
      drag: 0.7,
    });
    this.audio.play('count');
  }

  dispose(): void {
    this.clear();
    this.geo.dispose();
    this.matNormal.dispose();
    this.matAir.dispose();
  }
}
