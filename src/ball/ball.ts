import { MATCH_BALL_RADIUS } from '../physics/colliders.ts';
import * as THREE from 'three';
import { BallBody } from '../physics/world.ts';
import { clamp } from '../core/math.ts';
import { createBallTexture, getBallDesign, type BallDesign } from './ballDesigns.ts';

const TRAIL_POINTS = 26;

/** Visual + physical football. */
export class Ball {
  readonly body = new BallBody();
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private texture: THREE.CanvasTexture;
  private trail: THREE.Line;
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private trailGeo: THREE.BufferGeometry;
  private trailMat: THREE.LineBasicMaterial;
  private history: number[] = [];
  private squash = 0;
  private design: BallDesign;
  private shadow: THREE.Mesh;
  private glow: THREE.Sprite;
  private spinQuat = new THREE.Quaternion();
  private tmpQuat = new THREE.Quaternion();
  private tmpAxis = new THREE.Vector3();

  constructor(designId = 'classic') {
    this.design = getBallDesign(designId);
    this.texture = createBallTexture(this.design);
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: this.design.roughness,
      metalness: this.design.metalness,
      emissive: new THREE.Color(this.design.emissiveColor),
      emissiveIntensity: this.design.emissive,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 18), this.material);
    this.mesh.castShadow = true;
    this.mesh.scale.setScalar(this.body.radius);
    this.group.add(this.mesh);

    // Contact shadow so the height of the ball is always readable.
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;

    // Speed trail.
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPositions = new Float32Array(TRAIL_POINTS * 3);
    this.trailColors = new Float32Array(TRAIL_POINTS * 3);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));
    this.trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.trail = new THREE.Line(this.trailGeo, this.trailMat);
    this.trail.frustumCulled = false;

    const glowTex = makeGlowTexture();
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: this.design.trailColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.scale.setScalar(1.6);
    this.group.add(this.glow);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
    scene.add(this.shadow);
    scene.add(this.trail);
  }

  setDesign(id: string): void {
    this.design = getBallDesign(id);
    this.texture.dispose();
    this.texture = createBallTexture(this.design);
    this.material.map = this.texture;
    this.material.roughness = this.design.roughness;
    this.material.metalness = this.design.metalness;
    this.material.emissive.setHex(this.design.emissiveColor);
    this.material.emissiveIntensity = this.design.emissive;
    this.material.needsUpdate = true;
    (this.glow.material as THREE.SpriteMaterial).color.setHex(this.design.trailColor);
  }

  setRadius(r: number): void {
    this.body.radius = r;
    this.mesh.scale.setScalar(r);
    this.shadow.scale.setScalar(r / MATCH_BALL_RADIUS);
  }

  /** Visual squash on hard contacts. */
  impact(strength: number): void {
    this.squash = Math.min(1, this.squash + strength);
  }

  reset(x: number, y: number, z: number): void {
    this.body.reset(x, y, z);
    this.history.length = 0;
    this.group.position.set(x, y, z);
    this.spinQuat.identity();
  }

  update(dt: number, groundY: number): void {
    const b = this.body;
    this.group.position.set(b.position.x, b.position.y, b.position.z);

    // Rotate the mesh by angular velocity.
    const w = b.spin;
    const wl = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
    if (wl > 1e-4) {
      this.tmpAxis.set(w.x / wl, w.y / wl, w.z / wl);
      this.tmpQuat.setFromAxisAngle(this.tmpAxis, wl * dt);
      this.spinQuat.premultiply(this.tmpQuat);
      this.mesh.quaternion.copy(this.spinQuat);
    }

    // Squash & stretch.
    this.squash = Math.max(0, this.squash - dt * 5.5);
    const s = b.radius;
    const sq = this.squash * 0.28;
    this.mesh.scale.set(s * (1 + sq * 0.6), s * (1 - sq), s * (1 + sq * 0.6));

    // Shadow.
    const height = Math.max(0, b.position.y - groundY);
    const k = clamp(1 - height * 0.07, 0.25, 1);
    this.shadow.position.set(b.position.x, groundY + 0.015, b.position.z);
    this.shadow.scale.setScalar((b.radius / MATCH_BALL_RADIUS) * k);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.34 * k;

    // Trail, shown only for quick balls.
    const speed = b.speed;
    this.history.unshift(b.position.x, b.position.y, b.position.z);
    if (this.history.length > TRAIL_POINTS * 3) this.history.length = TRAIL_POINTS * 3;
    const intensity = clamp((speed - 11) / 20, 0, 1);
    const color = new THREE.Color(this.design.trailColor);
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const idx = Math.min(i * 3, Math.max(0, this.history.length - 3));
      this.trailPositions[i * 3] = this.history[idx] ?? b.position.x;
      this.trailPositions[i * 3 + 1] = this.history[idx + 1] ?? b.position.y;
      this.trailPositions[i * 3 + 2] = this.history[idx + 2] ?? b.position.z;
      const fade = (1 - i / TRAIL_POINTS) * intensity;
      this.trailColors[i * 3] = color.r * fade;
      this.trailColors[i * 3 + 1] = color.g * fade;
      this.trailColors[i * 3 + 2] = color.b * fade;
    }
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;
    this.trail.visible = intensity > 0.02;

    const glowMat = this.glow.material as THREE.SpriteMaterial;
    glowMat.opacity = intensity * 0.55;
    this.glow.scale.setScalar(b.radius * (3.4 + intensity * 2.4));
    this.glow.visible = intensity > 0.02;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.trailGeo.dispose();
    this.trailMat.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    (this.glow.material as THREE.SpriteMaterial).map?.dispose();
    (this.glow.material as THREE.Material).dispose();
  }
}

let glowTexture: THREE.CanvasTexture | null = null;
function makeGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}
