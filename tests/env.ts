/**
 * Headless environment shim.
 * The sandbox has no browser available, so we stub just enough DOM/WebGL for the
 * real game code to boot and be simulated in Node for automated play-testing.
 */

interface FakeCtx2D {
  [key: string]: unknown;
}

function fakeContext2D(width: number, height: number): FakeCtx2D {
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  return {
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

const listeners = new Map<string, ((e: unknown) => void)[]>();

/** Fire a DOM-ish event at whatever the game registered on window. */
export function fireEvent(type: string, init: Record<string, unknown> = {}): void {
  const event = {
    type,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    repeat: false,
    button: 0,
    buttons: 0,
    movementX: 0,
    movementY: 0,
    deltaY: 0,
    ...init,
  };
  for (const cb of listeners.get(type) ?? []) cb(event);
}

export function installHeadlessEnv(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.__kickoffEnv) return;
  g.__kickoffEnv = true;

  const makeElement = (tag: string): Record<string, unknown> => {
    const children: unknown[] = [];
    const element: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      style: {},
      className: '',
      children,
      dataset: {},
      width: 300,
      height: 150,
      clientWidth: 1280,
      clientHeight: 720,
      textContent: '',
      innerHTML: '',
      classList: {
        add: () => undefined,
        remove: () => undefined,
        toggle: () => undefined,
        contains: () => false,
      },
      append: (...nodes: unknown[]) => children.push(...nodes),
      appendChild: (n: unknown) => {
        children.push(n);
        return n;
      },
      removeChild: () => undefined,
      remove: () => undefined,
      setAttribute: () => undefined,
      getAttribute: () => null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getContext: (type: string) =>
        type === '2d' ? fakeContext2D(Number(element.width), Number(element.height)) : fakeWebGL(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      focus: () => undefined,
      requestPointerLock: () => undefined,
      toDataURL: () => 'data:,',
      firstChild: null,
      offsetWidth: 100,
    };
    return element;
  };

  const doc: Record<string, unknown> = {
    createElement: (tag: string) => makeElement(tag),
    createElementNS: (_ns: string, tag: string) => makeElement(tag),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
    getElementById: () => makeElement('div'),
    querySelector: () => makeElement('div'),
    body: makeElement('body'),
    documentElement: makeElement('html'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    exitPointerLock: () => undefined,
    pointerLockElement: null,
    hidden: false,
  };

  const store = new Map<string, string>();

  g.document = doc;
  g.window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: (type: string, cb: (e: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    removeEventListener: () => undefined,
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
    setInterval: (fn: () => void, ms?: number) => setInterval(fn, ms) as unknown as number,
    clearInterval: (id: number) => clearInterval(id),
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16) as unknown as number,
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    AudioContext: undefined,
    location: { reload: () => undefined },
  };
  const define = (key: string, value: unknown) => {
    try {
      Object.defineProperty(g, key, { value, configurable: true, writable: true });
    } catch {
      /* ignore read-only globals */
    }
  };
  define('navigator', { userAgent: 'node', getGamepads: () => [] });
  define('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
  g.requestAnimationFrame = (g.window as Record<string, unknown>).requestAnimationFrame;
  g.HTMLElement = class {};
  g.Image = class {};
  g.ImageData = class {};
  g.self = g.window;
}
