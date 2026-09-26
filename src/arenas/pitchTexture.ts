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

  // ---- Surface: mowing stripes + grain, composed in one pixel pass --------
  // (Drawing noise with putImageData would *replace* the pixels underneath -
  // including the grass colour - so the base is built in the buffer itself.)
  const a = new THREE.Color(theme.grassA);
  const b = new THREE.Color(theme.grassB);
  const stripes = theme.surface === 'ice' ? 0 : 9;
  const grain = theme.surface === 'sand' ? 0.055 : theme.surface === 'ice' ? 0.022 : 0.045;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  // Low-frequency blotches so the turf is not perfectly uniform.
  const blobs: [number, number, number, number][] = [];
  for (let i = 0; i < 26; i++) {
    blobs.push([Math.random() * w, Math.random() * h, 60 + Math.random() * 190, (Math.random() - 0.5) * 0.07]);
  }
  for (let y = 0; y < h; y++) {
    const stripe = stripes > 0 && Math.floor((y / h) * stripes) % 2 === 1;
    for (let x = 0; x < w; x++) {
      const base = stripe ? b : a;
      let shade = 1 + (Math.random() - 0.5) * grain;
      for (const [bx, by, br, amp] of blobs) {
        const d2 = (x - bx) * (x - bx) + (y - by) * (y - by);
        if (d2 < br * br) shade += amp * (1 - Math.sqrt(d2) / br);
      }
      // Slight wear in front of each goal, like a real pitch.
      const goalWear = Math.max(
        0,
        1 - Math.hypot((x - w / 2) / (w * 0.22), (Math.min(y, h - y) - h * 0.06) / (h * 0.1)),
      );
      shade -= goalWear * 0.06;
      // Vignette towards the touchlines keeps the eye on the middle.
      const edge = Math.min(1, Math.min(x, w - x) / (w * 0.08)) * Math.min(1, Math.min(y, h - y) / (h * 0.06));
      shade *= 0.93 + edge * 0.07;
      const o = (y * w + x) * 4;
      data[o] = Math.max(0, Math.min(255, base.r * 255 * shade));
      data[o + 1] = Math.max(0, Math.min(255, base.g * 255 * shade));
      data[o + 2] = Math.max(0, Math.min(255, base.b * 255 * shade));
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Markings.
  const line = hex(theme.lineColor);
  ctx.strokeStyle = line;
  ctx.fillStyle = line;
  ctx.lineWidth = Math.max(3, pxPerMeter * 0.13);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
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
