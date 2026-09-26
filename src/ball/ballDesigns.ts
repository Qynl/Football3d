import * as THREE from 'three';

export interface BallDesign {
  id: string;
  name: string;
  /** Emissive strength for glowy balls. */
  emissive: number;
  emissiveColor: number;
  roughness: number;
  metalness: number;
  trailColor: number;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}

function base(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

/** Classic panel look: hex-ish patches laid out on the UV sphere. */
function classicPanels(ctx: CanvasRenderingContext2D, w: number, h: number, dark: string): void {
  ctx.fillStyle = dark;
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = ((r + 0.5) / rows) * h;
    const count = r === 0 || r === rows - 1 ? 5 : 6;
    const offset = r % 2 ? 0.5 : 0;
    const rad = h * (r === 0 || r === rows - 1 ? 0.085 : 0.1);
    for (let i = 0; i < count; i++) {
      const x = ((i + offset) / count) * w;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2 + (r % 2 ? 0.3 : 0);
        const px = Math.cos(a) * rad * 1.35;
        const py = Math.sin(a) * rad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

export const BALL_DESIGNS: BallDesign[] = [
  {
    id: 'classic',
    name: 'Classic',
    emissive: 0,
    emissiveColor: 0x000000,
    roughness: 0.55,
    metalness: 0.02,
    trailColor: 0xffffff,
    draw(ctx, w, h) {
      base(ctx, w, h, '#f7f9fc');
      classicPanels(ctx, w, h, '#1d2330');
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    emissive: 0.9,
    emissiveColor: 0x22e0ff,
    roughness: 0.3,
    metalness: 0.1,
    trailColor: 0x22e0ff,
    draw(ctx, w, h) {
      base(ctx, w, h, '#06121c');
      ctx.strokeStyle = '#22e0ff';
      ctx.lineWidth = h * 0.035;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.arc((i / 7) * w + w / 14, h / 2, h * 0.24, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ff3df5';
      ctx.lineWidth = h * 0.02;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    },
  },
  {
    id: 'fire',
    name: 'Fire',
    emissive: 0.75,
    emissiveColor: 0xff7a18,
    roughness: 0.45,
    metalness: 0,
    trailColor: 0xff7a18,
    draw(ctx, w, h) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#2b0a00');
      grad.addColorStop(0.5, '#ff7a18');
      grad.addColorStop(1, '#2b0a00');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,220,80,0.85)';
      for (let i = 0; i < 40; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.beginPath();
        ctx.ellipse(x, y, h * 0.03, h * 0.07, Math.random(), 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'pixel',
    name: 'Pixel',
    emissive: 0,
    emissiveColor: 0x000000,
    roughness: 0.8,
    metalness: 0,
    trailColor: 0x9bf6ff,
    draw(ctx, w, h) {
      const cols = 28;
      const rows = 14;
      const palette = ['#f2f6ff', '#c9d6f0', '#1d2330', '#4d5b7c'];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
          ctx.fillRect((x / cols) * w, (y / rows) * h, w / cols + 1, h / rows + 1);
        }
      }
    },
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    emissive: 0.45,
    emissiveColor: 0x7b5bff,
    roughness: 0.35,
    metalness: 0.3,
    trailColor: 0xb18cff,
    draw(ctx, w, h) {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#120a2a');
      grad.addColorStop(0.5, '#3a1a6b');
      grad.addColorStop(1, '#0a1030');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) {
        const r = Math.random() * 1.8 + 0.4;
        ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.65})`;
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'beach',
    name: 'Beach',
    emissive: 0,
    emissiveColor: 0x000000,
    roughness: 0.4,
    metalness: 0.05,
    trailColor: 0xffd93d,
    draw(ctx, w, h) {
      const colors = ['#ff5a5f', '#ffd93d', '#2ec4b6', '#f2f6ff', '#2f80ed', '#ff8c42'];
      const slices = 12;
      for (let i = 0; i < slices; i++) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect((i / slices) * w, 0, w / slices + 1, h);
      }
    },
  },
  {
    id: 'metal',
    name: 'Metal',
    emissive: 0,
    emissiveColor: 0x000000,
    roughness: 0.18,
    metalness: 0.95,
    trailColor: 0xdfe8ff,
    draw(ctx, w, h) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#6b7893');
      grad.addColorStop(0.45, '#e5ecfa');
      grad.addColorStop(0.6, '#98a4bd');
      grad.addColorStop(1, '#4a5468');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 16; i++) {
        ctx.beginPath();
        ctx.moveTo((i / 16) * w, 0);
        ctx.lineTo((i / 16) * w, h);
        ctx.stroke();
      }
    },
  },
];

export function getBallDesign(id: string): BallDesign {
  return BALL_DESIGNS.find((d) => d.id === id) ?? BALL_DESIGNS[0];
}

export function createBallTexture(design: BallDesign): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  design.draw(ctx, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
