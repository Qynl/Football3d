/**
 * Headless environment shim.
 *
 * There is no browser in this sandbox, so tests run the real game against a
 * jsdom document (React needs a genuine DOM) plus a hand-written WebGL2/2D
 * canvas stub (three.js needs a context, but there is no GPU).
 */
import { JSDOM } from 'jsdom';

interface FakeCtx2D {
  [key: string]: unknown;
}

function fakeContext2D(width: number, height: number): FakeCtx2D {
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  const base: FakeCtx2D = {
    canvas: { width, height },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '10px sans-serif',
    fillRect: noop,
    clearRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    drawImage: noop,
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    putImageData: noop,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
      width: w,
      height: h,
    }),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
      width: w,
      height: h,
    }),
  };
  // Anything else the texture painters reach for (rect, clip, lineCap, ...)
  // becomes a harmless no-op rather than a crash in a headless run.
  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      const fn = (): undefined => undefined;
      target[prop] = fn;
      return fn;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  });
}

/** A permissive WebGL2 stub: enough for three.js to initialise without a GPU. */
function fakeWebGL(): unknown {
  let objectId = 0;
  // Every GL constant gets a unique id so getParameter can answer sensibly.
  const constNames = new Map<number, string>();
  let nextConst = 0x1000;
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      // Constants three reads off the context.
      if (/^[A-Z0-9_]+$/.test(prop)) {
        const id = nextConst++;
        constNames.set(id, prop);
        target[prop] = id;
        return id;
      }
      const fn = (...args: unknown[]) => {
        switch (prop) {
          case 'getParameter': {
            const name = constNames.get(Number(args[0])) ?? '';
            if (name.includes('VERSION')) {
              return name.startsWith('SHADING')
                ? 'WebGL GLSL ES 3.00 (headless)'
                : 'WebGL 2.0 (headless)';
            }
            if (name === 'VENDOR' || name === 'RENDERER') return 'kickoff-headless';
            if (name.includes('MAX_VIEWPORT') || name.includes('RANGE')) {
              return new Int32Array([16384, 16384]);
            }
            if (name.startsWith('MAX_')) return 16384;
            return 1;
          }
          case 'getExtension':
            return {
              MAX_TEXTURE_MAX_ANISOTROPY_EXT: 1,
              UNMASKED_RENDERER_WEBGL: 1,
              UNMASKED_VENDOR_WEBGL: 1,
              loseContext: () => undefined,
              drawBuffersWEBGL: () => undefined,
            };
          case 'getSupportedExtensions':
            return [];
          case 'getShaderPrecisionFormat':
            return { rangeMin: 127, rangeMax: 127, precision: 23 };
          case 'createProgram':
          case 'createShader':
          case 'createBuffer':
          case 'createTexture':
          case 'createFramebuffer':
          case 'createRenderbuffer':
          case 'createVertexArray':
          case 'createQuery':
            return { id: `${prop}-${objectId++}` };
          case 'getProgramParameter':
          case 'getShaderParameter':
            return true;
          case 'getProgramInfoLog':
          case 'getShaderInfoLog':
            return '';
          case 'getUniformLocation':
            return { id: String(args[1] ?? '') };
          case 'getAttribLocation':
            return 0;
          case 'getActiveUniform':
          case 'getActiveAttrib':
            return { name: 'x', type: 1, size: 1 };
          case 'getContextAttributes':
            return { alpha: true, antialias: true, depth: true, stencil: false };
          case 'isContextLost':
            return false;
          default:
            return undefined;
        }
      };
      target[prop] = fn;
      return fn;
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

let jsdomWindow: (Window & typeof globalThis) | null = null;

/** Fire a real DOM event at the window, exactly as a browser would. */
export function fireEvent(type: string, init: Record<string, unknown> = {}): void {
  const w = jsdomWindow as unknown as Record<string, new (t: string, i?: unknown) => Event>;
  if (!jsdomWindow) throw new Error('installHeadlessEnv() first');
  const ctor =
    type.startsWith('key') ? w.KeyboardEvent : type.startsWith('mouse') ? w.MouseEvent : w.Event;
  const event = new ctor(type, { bubbles: true, cancelable: true, ...init });
  jsdomWindow.dispatchEvent(event);
}

export function installHeadlessEnv(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.__kickoffEnv) return;
  g.__kickoffEnv = true;

  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"></div></body></html>`,
    { url: 'http://localhost:5173/', pretendToBeVisual: true },
  );
  const win = dom.window as unknown as Window & typeof globalThis;
  jsdomWindow = win;

  // Canvases have no GPU here: hand back the stub contexts instead.
  const canvasProto = (dom.window as unknown as {
    HTMLCanvasElement: { prototype: { getContext: unknown } };
  }).HTMLCanvasElement.prototype;
  canvasProto.getContext = function getContext(this: { width: number; height: number }, type: string) {
    return type === '2d' ? fakeContext2D(this.width || 300, this.height || 150) : fakeWebGL();
  };

  const define = (key: string, value: unknown): void => {
    try {
      Object.defineProperty(g, key, { value, configurable: true, writable: true });
    } catch {
      /* some globals are read-only; the jsdom copy below still covers them */
    }
  };

  // Publish the jsdom globals the game (and React) expect to find.
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('localStorage', win.localStorage);
  define('self', win);
  for (const key of [
    'HTMLElement',
    'HTMLCanvasElement',
    'HTMLInputElement',
    'Element',
    'Node',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'PointerEvent',
    'CustomEvent',
    'Image',
    'ImageData',
    'MutationObserver',
    'getComputedStyle',
    'DOMRect',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    const value = (win as unknown as Record<string, unknown>)[key];
    if (value !== undefined) define(key, value);
  }

  // jsdom has no WebAudio; the engine already degrades gracefully without it.
  define('AudioContext', undefined);
}
