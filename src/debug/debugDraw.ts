import * as THREE from 'three';

const MAX_VERTS = 8000;

/** Immediate-mode line renderer for debug gizmos. */
export class DebugDraw {
  readonly object: THREE.LineSegments;
  private positions: Float32Array;
  private colors: Float32Array;
  private geometry: THREE.BufferGeometry;
  private count = 0;
  enabled = false;

  constructor() {
    this.positions = new Float32Array(MAX_VERTS * 3);
    this.colors = new Float32Array(MAX_VERTS * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 });
    this.object = new THREE.LineSegments(this.geometry, mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 999;
  }

  begin(): void {
    this.count = 0;
  }

  line(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: number): void {
    if (this.count + 2 > MAX_VERTS) return;
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    const i = this.count * 3;
    this.positions[i] = x1;
    this.positions[i + 1] = y1;
    this.positions[i + 2] = z1;
    this.positions[i + 3] = x2;
    this.positions[i + 4] = y2;
    this.positions[i + 5] = z2;
    this.colors[i] = r;
    this.colors[i + 1] = g;
    this.colors[i + 2] = b;
    this.colors[i + 3] = r;
    this.colors[i + 4] = g;
    this.colors[i + 5] = b;
    this.count += 2;
  }

  circle(x: number, y: number, z: number, radius: number, color: number, segments = 24): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.line(
        x + Math.cos(a0) * radius,
        y,
        z + Math.sin(a0) * radius,
        x + Math.cos(a1) * radius,
        y,
        z + Math.sin(a1) * radius,
        color,
      );
    }
  }

  sphere(x: number, y: number, z: number, radius: number, color: number): void {
    this.circle(x, y, z, radius, color, 16);
    const segments = 16;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.line(
        x + Math.cos(a0) * radius,
        y + Math.sin(a0) * radius,
        z,
        x + Math.cos(a1) * radius,
        y + Math.sin(a1) * radius,
        z,
        color,
      );
      this.line(
        x,
        y + Math.sin(a0) * radius,
        z + Math.cos(a0) * radius,
        x,
        y + Math.sin(a1) * radius,
        z + Math.cos(a1) * radius,
        color,
      );
    }
  }

  capsule(x: number, y: number, z: number, radius: number, height: number, color: number): void {
    this.circle(x, y + 0.02, z, radius, color, 16);
    this.circle(x, y + height, z, radius, color, 16);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      this.line(
        x + Math.cos(a) * radius,
        y,
        z + Math.sin(a) * radius,
        x + Math.cos(a) * radius,
        y + height,
        z + Math.sin(a) * radius,
        color,
      );
    }
  }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): void {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const c = [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, -hy, hz],
      [-hx, -hy, hz],
      [-hx, hy, -hz],
      [hx, hy, -hz],
      [hx, hy, hz],
      [-hx, hy, hz],
    ];
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [a, b] of edges) {
      this.line(x + c[a][0], y + c[a][1], z + c[a][2], x + c[b][0], y + c[b][1], z + c[b][2], color);
    }
  }

  arrow(x: number, y: number, z: number, dx: number, dy: number, dz: number, color: number): void {
    this.line(x, y, z, x + dx, y + dy, z + dz, color);
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    const tipX = x + dx;
    const tipY = y + dy;
    const tipZ = z + dz;
    const back = 0.25 * len;
    this.line(tipX, tipY, tipZ, tipX - nx * back + nz * back * 0.4, tipY, tipZ - nz * back - nx * back * 0.4, color);
    this.line(tipX, tipY, tipZ, tipX - nx * back - nz * back * 0.4, tipY, tipZ - nz * back + nx * back * 0.4, color);
  }

  end(): void {
    this.geometry.setDrawRange(0, this.count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.object.visible = this.enabled && this.count > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
