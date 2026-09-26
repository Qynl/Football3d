import * as THREE from 'three';
import type { ArenaDef } from './arenaDefs.ts';

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Procedurally paints the pitch surface: stripes, noise and line markings. */
export function createPitchTexture(def: ArenaDef): THREE.CanvasTexture {
  const pxPerMeter = 26;
  const w = Math.round(def.halfWidth * 2 * pxPerMeter);
  const h = Math.round(def.halfLength * 2 * pxPerMeter);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const theme = def.theme;

  ctx.fillStyle = hex(theme.grassA);
  ctx.fillRect(0, 0, w, h);

  // Mowing stripes along the length of the pitch.
  const stripes = def.theme.surface === 'ice' ? 0 : 10;
  for (let i = 0; i < stripes; i++) {
    if (i % 2 === 0) continue;
    ctx.fillStyle = hex(theme.grassB);
    ctx.fillRect(0, (i / stripes) * h, w, h / stripes);
  }

  // Surface grain.
  const grain = ctx.createImageData(w, h);
  const strength = theme.surface === 'sand' ? 26 : theme.surface === 'ice' ? 10 : 18;
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (Math.random() - 0.5) * strength;
    grain.data[i] = 128 + n;
    grain.data[i + 1] = 128 + n;
    grain.data[i + 2] = 128 + n;
    grain.data[i + 3] = Math.abs(n) * 3;
  }
  ctx.globalCompositeOperation = 'overlay';
  ctx.putImageData(grain, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  // Markings.
  const line = hex(theme.lineColor);
  ctx.strokeStyle = line;
  ctx.fillStyle = line;
  ctx.lineWidth = Math.max(3, pxPerMeter * 0.13);
  const inset = pxPerMeter * 0.55;
  ctx.globalAlpha = theme.surface === 'sand' ? 0.55 : 0.85;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

  // Halfway line + centre circle + spot.
  ctx.beginPath();
  ctx.moveTo(inset, h / 2);
  ctx.lineTo(w - inset, h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, pxPerMeter * 3.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, pxPerMeter * 0.22, 0, Math.PI * 2);
  ctx.fill();

  // Penalty areas + spots at both ends.
  const boxW = Math.min(w - inset * 2 - 8, (def.goalWidth + 5.5) * pxPerMeter);
  const boxD = 4.4 * pxPerMeter;
  for (const top of [true, false]) {
    const y = top ? inset : h - inset - boxD;
    ctx.strokeRect((w - boxW) / 2, y, boxW, boxD);
    const smallW = (def.goalWidth + 2.0) * pxPerMeter;
    const smallD = 1.8 * pxPerMeter;
    const sy = top ? inset : h - inset - smallD;
    ctx.strokeRect((w - smallW) / 2, sy, smallW, smallD);
    const spotY = top ? inset + boxD * 0.62 : h - inset - boxD * 0.62;
    ctx.beginPath();
    ctx.arc(w / 2, spotY, pxPerMeter * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Penalty arc.
    ctx.beginPath();
    ctx.arc(w / 2, spotY, pxPerMeter * 2.6, top ? 0 : Math.PI, top ? Math.PI : Math.PI * 2);
    ctx.stroke();
  }

  // Corner arcs.
  const r = pxPerMeter * 0.7;
  const corners: [number, number, number, number][] = [
    [inset, inset, 0, Math.PI / 2],
    [w - inset, inset, Math.PI / 2, Math.PI],
    [w - inset, h - inset, Math.PI, Math.PI * 1.5],
    [inset, h - inset, Math.PI * 1.5, Math.PI * 2],
  ];
  for (const [cx, cy, a0, a1] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Net texture: a simple alpha grid. */
export function createNetTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 2.5;
  const cells = 8;
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sky gradient used as the scene background. */
export function createSkyTexture(top: number, bottom: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, hex(top));
  grad.addColorStop(1, hex(bottom));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
