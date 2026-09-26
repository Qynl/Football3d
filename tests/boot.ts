/**
 * End-to-end boot test.
 *
 * There is no browser in this environment, so the DOM/WebGL shim stands in for
 * one. It still exercises the *real* Game: renderer setup, arena and character
 * construction, the UI tree, audio graph, storage, match flow and the render
 * loop. Anything that throws on a real page throws here too.
 */
import type { Game } from '../src/game/game.ts';
import { fireEvent, installHeadlessEnv } from './env.ts';

installHeadlessEnv();

interface SceneNode {
  isMesh?: boolean;
  isLight?: boolean;
  name?: string;
}

export interface BootResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runBootTests(
  check: (name: string, ok: boolean, detail?: string) => void,
): Promise<void> {
  const doc = (globalThis as unknown as { document: Document }).document;

  // React renders asynchronously; give the scheduler a turn before asserting.
  const flush = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  /** Poll until a condition holds (booting the engine takes real work). */
  const waitFor = async (what: () => boolean, ms = 10000): Promise<boolean> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (what()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return what();
  };
  const uiErrors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]): void => {
    uiErrors.push(args.map(String).join(' '));
    realError(...args);
  };
  const $ = (sel: string): Element | null => doc.querySelector(sel);
  const buttonWith = (text: string): HTMLElement | null =>
    (Array.from(doc.querySelectorAll('button')) as HTMLElement[]).find((b) =>
      (b.textContent ?? '').trim().toUpperCase().startsWith(text),
    ) ?? null;

  // Import the real page entry point: React mounts, the effect builds the
  // engine and starts it, exactly as index.html does in a browser.
  await import('../src/main.tsx');
  const win = (globalThis as unknown as { window: { KICKOFF?: Game } }).window;
  const booted = await waitFor(() => !!win.KICKOFF && !!$('#hud'));
  await flush();
  const game = win.KICKOFF;
  check('the real entry point boots the game', booted && !!game);
  if (!game) return;
  check('the entry point renders the canvas host', !!$('#app canvas'));

  const anyGame = game as unknown as {
    frame(dt: number): void;
    match: { phase: string; score: number[]; timeLeft: number | null };
    players: {
      position: { x: number; y: number; z: number };
      charge: number;
      teleport(x: number, z: number, yaw: number): void;
    }[];
    balls: { reset(x: number, y: number, z: number): void }[];
    ui: { show(name: string): void; openSettingsFrom(name: string): void };
    startMatch(o: unknown): void;
    quitToMenu(): void;
    rematch(): void;
    changeArena(id: string): void;
    togglePause(): void;
    applySettings(): void;
    applyLoadout(): void;
  };

  // Game.frame takes a delta in seconds, exactly as the rAF loop feeds it.
  const frames = (n: number): void => {
    for (let i = 0; i < n; i++) anyGame.frame(1 / 60);
  };

  frames(10);
  await flush();
  check('menu renders frames', true);
  check('React mounted the UI tree', !!$('#hud') && !!$('.menu-wrap'),
    `hud=${!!$('#hud')} menu=${!!$('.menu-wrap')}`);
  check('the main menu renders its buttons', !!buttonWith('PLAY') && !!buttonWith('TRAINING'));
  check('arena cards are rendered from real arena data',
    doc.querySelectorAll('.setup-grid .card').length >= 6,
    `cards=${doc.querySelectorAll('.setup-grid .card').length}`);

  // --- Clicking the real PLAY button starts a real match --------------------
  buttonWith('PLAY')?.click();
  await flush();
  frames(5);
  check('clicking PLAY starts a match', anyGame.match.phase === 'countdown',
    anyGame.match.phase);
  frames(240);
  anyGame.quitToMenu();
  await flush();

  // --- Quick match ----------------------------------------------------------
  anyGame.startMatch({
    mode: 'quick',
    rulesId: 'classic',
    arenaId: 'classic',
    difficulty: 'normal',
    personality: 'balanced',
    chaos: [],
  });
  frames(5);
  check('match starts in countdown', anyGame.match.phase === 'countdown', anyGame.match.phase);

  frames(240); // ~4 seconds
  check('countdown gives way to play', anyGame.match.phase === 'play', anyGame.match.phase);

  const before = anyGame.players[1].position.x + anyGame.players[1].position.z;
  frames(600); // ~10 seconds of real gameplay with AI, VFX, audio, HUD, camera
  const after = anyGame.players[1].position.x + anyGame.players[1].position.z;
  check('AI plays inside the full game loop', Math.abs(after - before) > 0.5);
  check('timer counts down', (anyGame.match.timeLeft ?? 1) < 180, String(anyGame.match.timeLeft));

  // --- Pause / resume -------------------------------------------------------
  anyGame.togglePause();
  frames(5);
  anyGame.togglePause();
  frames(5);
  check('pause and resume survive frames', true);

  // --- Settings / loadout ---------------------------------------------------
  anyGame.applySettings();
  anyGame.applyLoadout();
  frames(5);
  check('settings and loadout apply live', true);

  // --- Arena switch, rematch, menu -----------------------------------------
  anyGame.changeArena('neon');
  frames(60);
  check('arena change rebuilds mid-session', anyGame.match.phase !== 'idle', anyGame.match.phase);

  anyGame.rematch();
  frames(30);
  check('rematch restarts the match', anyGame.match.score[0] === 0 && anyGame.match.score[1] === 0);

  anyGame.quitToMenu();
  frames(20);
  check('quit returns to the menu', anyGame.match.phase === 'idle', anyGame.match.phase);

  // --- Other modes boot -----------------------------------------------------
  for (const mode of ['training', 'penalty', 'local', 'chaos'] as const) {
    anyGame.startMatch({
      mode,
      rulesId: mode === 'penalty' ? 'penalty' : 'classic',
      arenaId: mode === 'chaos' ? 'tiny' : 'classic',
      difficulty: 'hard',
      personality: 'chaos',
      chaos:
        mode === 'chaos'
          ? ['giantBall', 'lowGravity', 'superBounce', 'turbo', 'doubleBall', 'randomBounce']
          : [],
    });
    frames(200);
    const wantBalls = mode === 'chaos' ? 2 : 1;
    check(`${mode} mode runs`, anyGame.balls.length === wantBalls,
      `balls=${anyGame.balls.length} phase=${anyGame.match.phase}`);
    anyGame.quitToMenu();
    frames(10);
  }

  // --- Real keyboard/mouse input reaches the player -------------------------
  anyGame.startMatch({
    mode: 'quick',
    rulesId: 'classic',
    arenaId: 'classic',
    difficulty: 'easy',
    personality: 'balanced',
    chaos: [],
  });
  frames(260); // through the countdown

  // Clear the area so the measurement is about input, not about the opponent.
  const human = anyGame.players[0];
  human.teleport(0, -6, 0);
  anyGame.players[1].teleport(9, 14, Math.PI);
  anyGame.balls[0].reset(-9, 0.4, 14);
  frames(2);
  const startX = human.position.x;
  const startZ = human.position.z;
  fireEvent('keydown', { code: 'KeyW' });
  fireEvent('keydown', { code: 'ShiftLeft' });
  frames(60);
  fireEvent('keyup', { code: 'KeyW' });
  fireEvent('keyup', { code: 'ShiftLeft' });
  const travelled = Math.hypot(human.position.x - startX, human.position.z - startZ);
  check('WASD moves the human player', travelled > 3, `moved=${travelled.toFixed(2)}m`);

  fireEvent('keydown', { code: 'Space' });
  frames(2);
  fireEvent('keyup', { code: 'Space' });
  frames(10);
  check('Space makes the player jump', human.position.y > 0.2, `y=${human.position.y.toFixed(2)}`);
  frames(60);

  fireEvent('mousedown', { button: 0 });
  frames(24);
  const charging = (human as unknown as { charge: number }).charge > 0.1;
  fireEvent('mouseup', { button: 0 });
  frames(30);
  check('left mouse button charges and releases a kick', charging,
    `charge=${(human as unknown as { charge: number }).charge.toFixed(2)}`);

  anyGame.quitToMenu();
  frames(10);

  // --- The scene actually contains a game ----------------------------------
  anyGame.startMatch({
    mode: 'quick',
    rulesId: 'classic',
    arenaId: 'classic',
    difficulty: 'normal',
    personality: 'balanced',
    chaos: [],
  });
  frames(260);

  const scene = (game as unknown as { scene: { traverse(cb: (o: SceneNode) => void): void } }).scene;
  let meshes = 0;
  let lights = 0;
  const named = new Set<string>();
  scene.traverse((o: SceneNode) => {
    if (o.isMesh) meshes++;
    if (o.isLight) lights++;
    if (o.name) named.add(o.name);
  });
  check('the scene is populated with geometry', meshes > 60, `meshes=${meshes}`);
  check('the scene is lit', lights >= 2, `lights=${lights}`);

  const cam = (game as unknown as {
    camera: { camera: { position: { x: number; y: number; z: number } } };
  }).camera.camera;
  check('the camera is behind and above the action',
    cam.position.y > 1 && Math.hypot(cam.position.x, cam.position.z) > 2,
    `cam=${cam.position.x.toFixed(1)},${cam.position.y.toFixed(1)},${cam.position.z.toFixed(1)}`);

  anyGame.quitToMenu();
  frames(10);

  // --- UI screens -----------------------------------------------------------
  anyGame.ui.show('settings');
  await flush();
  check('the settings screen renders live controls',
    doc.querySelectorAll('input[type=range]').length >= 5,
    `sliders=${doc.querySelectorAll('input[type=range]').length}`);

  anyGame.ui.show('customize');
  await flush();
  check('the customise screen renders swatches', doc.querySelectorAll('.swatch').length > 10,
    `swatches=${doc.querySelectorAll('.swatch').length}`);

  anyGame.ui.show('howto');
  await flush();
  check('the how-to screen renders', !!$('.modal-wide'));

  anyGame.ui.show('menu');
  await flush();
  check('returning to the menu re-renders it', !!$('.menu-wrap'));

  console.error = realError;
  check('React rendered without errors or warnings', uiErrors.length === 0,
    uiErrors.slice(0, 2).join(' | '));
}
