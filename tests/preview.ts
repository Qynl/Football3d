/**
 * Offline scene previewer (development tool, not part of the test suite).
 *
 * There is no GPU or browser in this environment, so this walks the real
 * THREE.Scene the game builds and rasterises it in software - z-buffered,
 * flat-shaded triangles with the scene's own sun/hemisphere/fog values - and
 * writes a PNG. It is not a pixel-accurate match for WebGL, but it shows
 * geometry, composition, silhouettes, poses and colour, which is what matters
 * when tuning the look.
 *
 *   node --import ./tests/loader.mjs tests/preview.ts shots/kickoff.png [preset]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { installHeadlessEnv } from './env.ts';

installHeadlessEnv();

// Give canvases a real 2D implementation so the procedural textures (pitch
// markings, nets, crowd) are actually painted and can be sampled below.
let napiCanvas: typeof import('@napi-rs/canvas') | null = null;
try {
  napiCanvas = await import('@napi-rs/canvas');
} catch {
  console.warn('@napi-rs/canvas not installed - textures will preview as flat colour');
}
if (napiCanvas) {
  const proto = (globalThis as unknown as {
    HTMLCanvasElement: { prototype: { getContext: (t: string) => unknown } };
  }).HTMLCanvasElement.prototype;
  const stubGetContext = proto.getContext;
  proto.getContext = function getContext(this: Record<string, unknown>, type: string) {
    if (type !== '2d') return stubGetContext.call(this, type);
    if (!this.__napi) {
      this.__napi = napiCanvas!.createCanvas(
        Number(this.width) || 300,
        Number(this.height) || 150,
      );
    }
    return (this.__napi as { getContext(t: '2d'): unknown }).getContext('2d');
  };
}

const { Game } = await import('../src/game/game.ts');

// --------------------------------------------------------------- png output

function writePng(path: string, w: number, h: number, rgb: Uint8Array): void {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff]! ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ------------------------------------------------------------- rasterisation

interface Sampler {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

const samplerCache = new WeakMap<object, Sampler | null>();

/** Reads back a procedurally painted canvas texture so triangles can sample it. */
function samplerFor(tex: THREE.Texture | null): Sampler | null {
  if (!tex || !tex.image) return null;
  const img = tex.image as Record<string, unknown>;
  if (samplerCache.has(img)) return samplerCache.get(img) ?? null;
  let s: Sampler | null = null;
  const napi = img.__napi as { width: number; height: number; getContext(t: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } } | undefined;
  if (napi) {
    const d = napi.getContext('2d').getImageData(0, 0, napi.width, napi.height);
    s = { w: napi.width, h: napi.height, data: d.data };
  }
  samplerCache.set(img, s);
  return s;
}

interface Tri {
  /** clip-space positions */
  p: THREE.Vector4[];
  /** per-vertex uv, when the material has a map */
  uv: number[][] | null;
  sampler: Sampler | null;
  repU: number;
  repV: number;
  /** flat lighting multiplier */
  lr: number;
  lg: number;
  lb: number;
  /** base colour */
  r: number;
  g: number;
  b: number;
  fog: number;
  fr: number;
  fg: number;
  fb: number;
  a: number;
  depth: number;
}

const W = 1024;
const H = 576;

function shade(
  base: THREE.Color,
  n: THREE.Vector3,
  sunDir: THREE.Vector3,
  sunColor: THREE.Color,
  sunI: number,
  skyColor: THREE.Color,
  groundColor: THREE.Color,
  ambI: number,
  emissive: number,
): [number, number, number] {
  const ndl = Math.max(0, n.dot(sunDir));
  // Hemisphere term: up-facing catches sky, down-facing catches bounce.
  const hemi = (n.y + 1) / 2;
  const lr = sunColor.r * sunI * ndl + (skyColor.r * hemi + groundColor.r * (1 - hemi)) * ambI;
  const lg = sunColor.g * sunI * ndl + (skyColor.g * hemi + groundColor.g * (1 - hemi)) * ambI;
  const lb = sunColor.b * sunI * ndl + (skyColor.b * hemi + groundColor.b * (1 - hemi)) * ambI;
  return [base.r * lr + emissive, base.g * lg + emissive, base.b * lb + emissive];
}

function render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, skyTop: number, skyBottom: number): Uint8Array {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  // Pull the real lighting out of the scene.
  let sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  let sunColor = new THREE.Color(0xffffff);
  let sunI = 1.2;
  let skyColor = new THREE.Color(0xbcd8ff);
  let groundColor = new THREE.Color(0x3fa14a);
  let ambI = 0.9;
  let fogColor = new THREE.Color(0x9fc6ff);
  let fogDensity = 0.012;
  scene.traverse((o) => {
    if ((o as THREE.DirectionalLight).isDirectionalLight) {
      const d = o as THREE.DirectionalLight;
      sunDir = d.position.clone().normalize();
      sunColor = d.color;
      sunI = d.intensity;
    }
    if ((o as THREE.HemisphereLight).isHemisphereLight) {
      const hl = o as THREE.HemisphereLight;
      skyColor = hl.color;
      groundColor = hl.groundColor;
      ambI = hl.intensity;
    }
  });
  if (scene.fog && (scene.fog as THREE.FogExp2).isFogExp2) {
    fogColor = (scene.fog as THREE.FogExp2).color;
    fogDensity = (scene.fog as THREE.FogExp2).density;
  }

  const opaque: Tri[] = [];
  const blended: Tri[] = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const camPos = camera.position;

  const pushMesh = (mesh: THREE.Mesh, matrix: THREE.Matrix4, tint?: THREE.Color): void => {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const index = geo.getIndex();
    const count = index ? index.count : pos.count;
    if (count > 60000) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mat = mats[0] as THREE.MeshStandardMaterial;
    const base = ((mat.color as THREE.Color | undefined) ?? new THREE.Color(0xcccccc)).clone();
    if (tint) base.multiply(tint);
    const sampler = samplerFor(mat.map ?? null);
    const uv = sampler ? geo.getAttribute('uv') : null;
    const repU = mat.map?.repeat.x ?? 1;
    const repV = mat.map?.repeat.y ?? 1;
    const opacity = mat.transparent ? mat.opacity : 1;
    if (opacity < 0.02) return;
    const unlit = (mat as unknown as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial === true;
    const emissive = mat.emissive ? (mat.emissive.r + mat.emissive.g + mat.emissive.b) / 3 : 0;
    const n = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();

    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const idx = index ? index.getX(i + k) : i + k;
        v[k]!.fromBufferAttribute(pos, idx).applyMatrix4(matrix);
      }
      let triUv: number[][] | null = null;
      if (sampler && uv) {
        triUv = [];
        for (let k = 0; k < 3; k++) {
          const idx = index ? index.getX(i + k) : i + k;
          triUv.push([uv.getX(idx) * repU, uv.getY(idx) * repV]);
        }
      }
      e1.subVectors(v[1]!, v[0]!);
      e2.subVectors(v[2]!, v[0]!);
      n.crossVectors(e1, e2).normalize();
      const cx = (v[0]!.x + v[1]!.x + v[2]!.x) / 3;
      const cy = (v[0]!.y + v[1]!.y + v[2]!.y) / 3;
      const cz = (v[0]!.z + v[1]!.z + v[2]!.z) / 3;
      // Two-sided: flip the normal towards the camera.
      if (n.x * (camPos.x - cx) + n.y * (camPos.y - cy) + n.z * (camPos.z - cz) < 0) n.multiplyScalar(-1);
      const white = new THREE.Color(1, 1, 1);
      const [lr, lg, lb] = unlit
        ? [1, 1, 1]
        : shade(white, n, sunDir, sunColor, sunI, skyColor, groundColor, ambI, emissive);
      const dist = Math.hypot(camPos.x - cx, camPos.y - cy, camPos.z - cz);
      const f = 1 - Math.exp(-Math.pow(dist * fogDensity, 2));

      const clip = [0, 1, 2].map((k) =>
        new THREE.Vector4(v[k]!.x, v[k]!.y, v[k]!.z, 1).applyMatrix4(vp),
      );
      const tri: Tri = {
        p: clip,
        uv: triUv,
        sampler,
        repU,
        repV,
        lr,
        lg,
        lb,
        r: base.r,
        g: base.g,
        b: base.b,
        fog: f,
        fr: fogColor.r,
        fg: fogColor.g,
        fb: fogColor.b,
        a: opacity,
        depth: dist,
      };
      if (opacity < 0.999 || mat.transparent || mat.alphaMap) blended.push(tri);
      else opaque.push(tri);
    }
  };

  scene.traverseVisible((o) => {
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      const m = new THREE.Matrix4();
      const world = new THREE.Matrix4();
      const tint = new THREE.Color();
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, m);
        world.multiplyMatrices(inst.matrixWorld, m);
        if (inst.instanceColor) {
          tint.setRGB(
            inst.instanceColor.getX(i),
            inst.instanceColor.getY(i),
            inst.instanceColor.getZ(i),
          );
          pushMesh(inst as unknown as THREE.Mesh, world, tint);
        } else {
          pushMesh(inst as unknown as THREE.Mesh, world);
        }
      }
      return;
    }
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) pushMesh(mesh, mesh.matrixWorld);
  });

  // ---- framebuffer + sky gradient -----------------------------------------
  const color = new Float32Array(W * H * 3);
  const depth = new Float32Array(W * H).fill(Infinity);
  const top = new THREE.Color(skyTop);
  const bot = new THREE.Color(skyBottom);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const r = top.r * (1 - t) + bot.r * t;
    const g = top.g * (1 - t) + bot.g * t;
    const b = top.b * (1 - t) + bot.b * t;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      color[i] = r;
      color[i + 1] = g;
      color[i + 2] = b;
    }
  }

  const drawTri = (t: Tri, blend: boolean): void => {
    // Near-plane clip in homogeneous space, carrying uv along the cut.
    const EPS = 1e-4;
    type V = { p: THREE.Vector4; uv: number[] };
    const verts: V[] = t.p.map((p, i) => ({ p, uv: t.uv ? t.uv[i]! : [0, 0] }));
    const insideCount = verts.filter((x) => x.p.w > EPS).length;
    let polys: V[][] = [];
    if (insideCount === 3) polys = [verts];
    else if (insideCount === 0) return;
    else {
      const out: V[] = [];
      for (let i = 0; i < 3; i++) {
        const a = verts[i]!;
        const b = verts[(i + 1) % 3]!;
        const ain = a.p.w > EPS;
        const bin = b.p.w > EPS;
        if (ain) out.push(a);
        if (ain !== bin) {
          const s2 = (EPS - a.p.w) / (b.p.w - a.p.w);
          out.push({
            p: new THREE.Vector4(
              a.p.x + (b.p.x - a.p.x) * s2,
              a.p.y + (b.p.y - a.p.y) * s2,
              a.p.z + (b.p.z - a.p.z) * s2,
              EPS,
            ),
            uv: [a.uv[0]! + (b.uv[0]! - a.uv[0]!) * s2, a.uv[1]! + (b.uv[1]! - a.uv[1]!) * s2],
          });
        }
      }
      if (out.length === 3) polys = [out];
      else if (out.length === 4) polys = [[out[0]!, out[1]!, out[2]!], [out[0]!, out[2]!, out[3]!]];
      else return;
    }

    const sampler = t.sampler;
    for (const poly of polys) {
      const sx: number[] = [];
      const sy: number[] = [];
      const sz: number[] = [];
      const iw: number[] = [];
      for (const vtx of poly) {
        const p = vtx.p;
        sx.push(((p.x / p.w) * 0.5 + 0.5) * W);
        sy.push((1 - ((p.y / p.w) * 0.5 + 0.5)) * H);
        sz.push(p.z / p.w);
        iw.push(1 / p.w);
      }
      const minX = Math.max(0, Math.floor(Math.min(...sx)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(...sx)));
      const minY = Math.max(0, Math.floor(Math.min(...sy)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(...sy)));
      if (minX > maxX || minY > maxY) continue;
      const x0 = sx[0]!, y0 = sy[0]!, x1 = sx[1]!, y1 = sy[1]!, x2 = sx[2]!, y2 = sy[2]!;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) continue;
      const u0 = (poly[0]!.uv[0]! * iw[0]!), u1 = (poly[1]!.uv[0]! * iw[1]!), u2 = (poly[2]!.uv[0]! * iw[2]!);
      const vv0 = (poly[0]!.uv[1]! * iw[0]!), vv1 = (poly[1]!.uv[1]! * iw[1]!), vv2 = (poly[2]!.uv[1]! * iw[2]!);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
          const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * sz[0]! + w1 * sz[1]! + w2 * sz[2]!;
          const i = y * W + x;
          if (z >= depth[i]!) continue;
          if (!blend) depth[i] = z;
          let baseR = t.r;
          let baseG = t.g;
          let baseB = t.b;
          let alpha = t.a;
          if (sampler) {
            const invW = w0 * iw[0]! + w1 * iw[1]! + w2 * iw[2]!;
            const u = (w0 * u0 + w1 * u1 + w2 * u2) / invW;
            const vtex = (w0 * vv0 + w1 * vv1 + w2 * vv2) / invW;
            const tx = Math.min(sampler.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * sampler.w)));
            const ty = Math.min(sampler.h - 1, Math.max(0, Math.floor((1 - (((vtex % 1) + 1) % 1)) * sampler.h)));
            const o = (ty * sampler.w + tx) * 4;
            // Canvas pixels are sRGB; the renderer decodes them to linear.
            baseR *= Math.pow(sampler.data[o]! / 255, 2.2);
            baseG *= Math.pow(sampler.data[o + 1]! / 255, 2.2);
            baseB *= Math.pow(sampler.data[o + 2]! / 255, 2.2);
            alpha *= sampler.data[o + 3]! / 255;
          }
          if (alpha < 0.01) continue;
          const lit = [
            baseR * t.lr * (1 - t.fog) + t.fr * t.fog,
            baseG * t.lg * (1 - t.fog) + t.fg * t.fog,
            baseB * t.lb * (1 - t.fog) + t.fb * t.fog,
          ];
          const j = i * 3;
          color[j] = color[j]! * (1 - alpha) + lit[0]! * alpha;
          color[j + 1] = color[j + 1]! * (1 - alpha) + lit[1]! * alpha;
          color[j + 2] = color[j + 2]! * (1 - alpha) + lit[2]! * alpha;
        }
      }
    }
  };

  for (const t of opaque) drawTri(t, false);
  blended.sort((a, b) => b.depth - a.depth);
  for (const t of blended) drawTri(t, true);

  // ---- tone map + gamma ----------------------------------------------------
  const out = new Uint8Array(W * H * 3);
  const expose = 1.05;
  for (let i = 0; i < color.length; i++) {
    const x = color[i]! * expose;
    // ACES-ish curve, matching the renderer's tone mapping closely enough.
    const v2 = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    out[i] = Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, v2), 1 / 2.2) * 255)));
  }
  return out;
}

// ------------------------------------------------------------------- presets

const outPath = process.argv[2] ?? 'shots/preview.png';
const preset = process.argv[3] ?? 'match';
const arenaId = process.argv[4] ?? 'classic';

// ------------------------------------------------- character contact sheet

if (process.argv[3] === 'rig') {
  const { CharacterRig, createPose } = await import('../src/characters/rig.ts');
  const { DEFAULT_COSMETICS } = await import('../src/characters/characterDefs.ts');
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
  sun.position.set(6, 9, 7);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a7a3a, 1.0));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x3f9a4d, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  type P = ReturnType<typeof createPose>;
  const setups: [string, (p: P, t: number) => void][] = [
    ['idle', (p) => { p.speed = 0; }],
    ['jog', (p) => { p.speed = 4.2; }],
    ['sprint', (p) => { p.speed = 9.2; }],
    ['charge', (p) => { p.speed = 1.2; p.charge = 0.85; }],
    ['kick', (p, t) => { p.speed = 5; p.kickSwing = clampT(1 - ((t * 2.2) % 1)); p.kickLeg = 1; }],
    ['jump', (p) => { p.speed = 5; p.grounded = false; p.verticalVelocity = 3.4; }],
    ['slide', (p) => { p.speed = 7; p.slide = 1; }],
    ['celebrate', (p, t) => { p.speed = 0; p.celebration = 'jump'; p.celebrationTime = t; }],
  ];
  function clampT(x: number): number { return Math.max(0, Math.min(1, x)); }

  const rigs = setups.map(([, setup], i) => {
    const rig = new CharacterRig({ ...DEFAULT_COSMETICS, shorts: 0x22306a, shirt: 0xe23b4e, skin: 0xe8b98c });
    const x = (i - (setups.length - 1) / 2) * 1.5;
    rig.root.position.set(x, 0, 0);
    rig.root.rotation.y = Math.PI / 2; // profile view reads animation best
    scene.add(rig.root);
    const pose = createPose();
    return { rig, pose, setup };
  });
  let t = 0;
  for (let f = 0; f < 240; f++) {
    t += 1 / 60;
    for (const r of rigs) {
      const pose = r.pose;
      pose.speed = 0;
      pose.grounded = true;
      pose.charge = 0;
      pose.kickSwing = 0;
      pose.slide = 0;
      pose.celebration = null;
      pose.maxSpeed = 9.4;
      pose.lookX = r.rig.root.position.x + 3;
      pose.lookY = 0.3;
      pose.lookZ = 0;
      r.setup(pose, t);
      r.rig.update(1 / 60, pose, 0);
    }
  }
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
  cam.position.set(0, 1.5, 14.2);
  cam.lookAt(0, 0.82, 0);
  writePng(outPath, W, H, render(scene, cam, 0x8fc4f5, 0xdfeeff));
  console.log('wrote', outPath, '(' + setups.map(([n]) => n).join(', ') + ')');
  process.exit(0);
}

const doc = (globalThis as unknown as { document: Document }).document;
const host = doc.createElement('div');
doc.body.append(host);
const game = new Game(host) as unknown as {
  frame(dt: number): void;
  start(): void;
  scene: THREE.Scene;
  camera: { camera: THREE.PerspectiveCamera };
  arena: { def: { theme: { sky: number; skyBottom: number } } };
  players: {
    position: { x: number; y: number; z: number };
    teleport(x: number, z: number, yaw: number): void;
    velocity: { x: number; y: number; z: number };
    charge: number;
    charging: boolean;
  }[];
  balls: { reset(x: number, y: number, z: number): void; body: { velocity: { x: number; y: number; z: number } } }[];
  startMatch(o: unknown): void;
  ui: { show(n: string): void };
};
game.start();

const frames = (n: number): void => {
  for (let i = 0; i < n; i++) game.frame(1 / 60);
};

if (preset === 'menu') {
  frames(120);
} else {
  game.startMatch({
    mode: 'quick',
    rulesId: 'classic',
    arenaId,
    difficulty: 'normal',
    personality: 'balanced',
    chaos: [],
  });
  frames(60 * 4); // through the countdown
  if (preset === 'match') frames(60 * 6);
  if (preset === 'kick') {
    game.players[0]!.teleport(0.6, -2.2, 0.15);
    game.balls[0]!.reset(0.9, 0.12, -1.3);
    game.players[0]!.charging = true;
    game.players[0]!.charge = 0.8;
    frames(3);
  }
  if (preset === 'air') {
    game.players[0]!.teleport(1, -3, 0.2);
    game.balls[0]!.reset(1.4, 2.4, -2.2);
    game.players[0]!.velocity.y = 4;
    frames(4);
  }
  if (preset === 'goalmouth') {
    game.players[0]!.teleport(1.5, 8, 0.1);
    game.balls[0]!.reset(0.5, 0.4, 10);
    frames(8);
  }
}

const theme = game.arena.def.theme;
const pixels = render(game.scene, game.camera.camera, theme.sky, theme.skyBottom);
writePng(outPath, W, H, pixels);
console.log('wrote', outPath);
process.exit(0);
