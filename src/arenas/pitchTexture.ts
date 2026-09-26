import * as THREE from 'three';
import type { ArenaDef } from './arenaDefs.ts';

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Blend two packed colours in sRGB space and return a css string. */
function mix(a: number, b: number, t: number): string {
  const ch = (shift: number): number =>
    Math.round((((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
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
  // Mowing stripes are a *subtle* sheen difference, not two different greens -
  // full-strength grassB reads as a fairground chequerboard once the renderer
  // decodes it to linear light.
  const b = new THREE.Color(theme.grassA).lerp(new THREE.Color(theme.grassB), 0.55);
  const stripes = theme.surface === 'ice' ? 0 : 14;
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

/**
 * Sky: a vertical gradient with soft procedural clouds banded around the
 * horizon, so the background is not a flat wash of colour.
 */
export function createSkyTexture(top: number, bottom: number, clouds = true): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // The texture is mapped equirectangularly, so v = 0 is straight up and
  // v = 0.5 is the horizon: the whole gradient has to live in the top half or
  // the sky washes out to the horizon colour everywhere you actually look.
  const horizon = h * 0.5;
  const grad = ctx.createLinearGradient(0, 0, 0, horizon);
  grad.addColorStop(0, hex(top));
  grad.addColorStop(0.55, mix(top, bottom, 0.55));
  grad.addColorStop(1, hex(bottom));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, horizon + 1);
  // Below the horizon: a slightly deeper haze, mostly hidden by the stands.
  const below = ctx.createLinearGradient(0, horizon, 0, h);
  below.addColorStop(0, hex(bottom));
  below.addColorStop(1, mix(bottom, 0x000000, 0.25));
  ctx.fillStyle = below;
  ctx.fillRect(0, horizon, w, h - horizon);

  if (clouds) {
    // Puffy clouds, flattened towards the horizon like real perspective.
    for (let i = 0; i < 30; i++) {
      const cx = Math.random() * w;
      const band = Math.pow(Math.random(), 0.8);
      const cy = h * (0.08 + band * 0.36);
      const squash = 0.28 + (1 - band) * 0.5;
      const scale = 34 + Math.random() * 120;
      const puffs = 4 + Math.floor(Math.random() * 5);
      const alpha = 0.2 + Math.random() * 0.4;
      for (let p = 0; p < puffs; p++) {
        const px = cx + (Math.random() - 0.5) * scale * 1.8;
        const py = cy + (Math.random() - 0.5) * scale * squash;
        const r = scale * (0.35 + Math.random() * 0.5);
        const g2 = ctx.createRadialGradient(px, py, 0, px, py, r);
        g2.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g2.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.45})`);
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * squash * 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/**
 * Perimeter hoarding strip: blocks of colour with invented wordmarks. Every
 * name here is made up for this game.
 */
export function createAdTexture(colors: readonly number[]): THREE.CanvasTexture {
  const w = 1536;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const words = [
    'KICKOFF!',
    'VOLT',
    'TURBO BOOT',
    'PITCHCRAFT',
    'HYPERGRASS',
    'BOUNCE CO.',
    'NIGHTLEAGUE',
    'STUDFORGE',
  ];
  const panels = 6;
  for (let i = 0; i < panels; i++) {
    const x = (i / panels) * w;
    const pw = w / panels;
    const base = colors[i % colors.length] ?? 0x2f80ed;
    ctx.fillStyle = '#' + base.toString(16).padStart(6, '0');
    ctx.fillRect(x, 0, pw, h);
    // Diagonal sheen.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, pw, h);
    ctx.clip();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x - 40, h);
    ctx.lineTo(x + pw * 0.55, 0);
    ctx.lineTo(x + pw * 0.95, 0);
    ctx.lineTo(x + pw * 0.2, h);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    // Wordmark.
    const word = words[i % words.length]!;
    const lum =
      (((base >> 16) & 255) * 0.299 + ((base >> 8) & 255) * 0.587 + (base & 255) * 0.114) / 255;
    ctx.fillStyle = lum > 0.62 ? '#12203a' : '#ffffff';
    ctx.font = 'bold 86px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, x + pw / 2, h / 2 + 4);
    // Divider.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, 0, 4, h);
  }
  // Top and bottom rails.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, w, 10);
  ctx.fillRect(0, h - 12, w, 12);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
