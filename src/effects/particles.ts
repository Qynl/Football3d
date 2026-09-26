import * as THREE from 'three';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  drag: number;
  r: number;
  g: number;
  b: number;
  bounce: boolean;
}

export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  count: number;
  color: number;
  colorJitter?: number;
  speed: number;
  speedJitter?: number;
  spread?: number;
  upBias?: number;
  size: number;
  sizeJitter?: number;
  life: number;
  gravity?: number;
  drag?: number;
  bounce?: boolean;
  /** Bias the emission along a direction. */
  dirX?: number;
  dirY?: number;
  dirZ?: number;
}

const MAX_PARTICLES = 700;

/** Pooled GPU-point particle system: zero allocations after construction. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private pool: Particle[] = [];
  private active: Particle[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 1, gravity: -9, drag: 0.6,
        r: 1, g: 1, b: 1, bounce: false,
      });
    }
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 4);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setDrawRange(0, 0);

    const sprite = makeParticleTexture();
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: sprite } },
      vertexShader: `
        attribute vec4 aColor;
        attribute float aSize;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (320.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec4 vColor;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  emit(o: EmitOptions): void {
    const color = new THREE.Color(o.color);
    for (let i = 0; i < o.count; i++) {
      const p = this.pool.pop();
      if (!p) return;
      const spread = o.spread ?? 1;
      let dx = (Math.random() - 0.5) * 2 * spread;
      let dy = (Math.random() - 0.5) * 2 * spread + (o.upBias ?? 0.5);
      let dz = (Math.random() - 0.5) * 2 * spread;
      dx += o.dirX ?? 0;
      dy += o.dirY ?? 0;
      dz += o.dirZ ?? 0;
      const l = Math.hypot(dx, dy, dz) || 1;
      const speed = o.speed * (1 + (Math.random() - 0.5) * (o.speedJitter ?? 0.6));
      p.x = o.x;
      p.y = o.y;
      p.z = o.z;
      p.vx = (dx / l) * speed;
      p.vy = (dy / l) * speed;
      p.vz = (dz / l) * speed;
      p.maxLife = o.life * (0.7 + Math.random() * 0.6);
      p.life = p.maxLife;
      p.size = o.size * (1 + (Math.random() - 0.5) * (o.sizeJitter ?? 0.5));
      p.gravity = o.gravity ?? -12;
      p.drag = o.drag ?? 0.8;
      p.bounce = o.bounce ?? false;
      const j = o.colorJitter ?? 0;
      p.r = Math.min(1, Math.max(0, color.r + (Math.random() - 0.5) * j));
      p.g = Math.min(1, Math.max(0, color.g + (Math.random() - 0.5) * j));
      p.b = Math.min(1, Math.max(0, color.b + (Math.random() - 0.5) * j));
      this.active.push(p);
    }
  }

  update(dt: number): void {
    let write = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.active.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.vy += p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.03) {
        if (p.bounce && p.vy < -0.5) {
          p.y = 0.03;
          p.vy = -p.vy * 0.35;
          p.vx *= 0.7;
          p.vz *= 0.7;
        } else {
          p.y = 0.03;
          p.vy = 0;
          p.vx *= 0.9;
          p.vz *= 0.9;
        }
      }
    }
    for (const p of this.active) {
      const t = p.life / p.maxLife;
      this.positions[write * 3] = p.x;
      this.positions[write * 3 + 1] = p.y;
      this.positions[write * 3 + 2] = p.z;
      this.colors[write * 4] = p.r;
      this.colors[write * 4 + 1] = p.g;
      this.colors[write * 4 + 2] = p.b;
      this.colors[write * 4 + 3] = Math.min(1, t * 1.6);
      this.sizes[write] = p.size * (0.4 + t * 0.6);
      write++;
    }
    this.geometry.setDrawRange(0, write);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.active) this.pool.push(p);
    this.active.length = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function makeParticleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
