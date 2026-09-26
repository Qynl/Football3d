/**
 * End-to-end boot test.
 *
 * There is no browser in this environment, so the DOM/WebGL shim stands in for
 * one. It still exercises the *real* Game: renderer setup, arena and character
 * construction, the UI tree, audio graph, storage, match flow and the render
 * loop. Anything that throws on a real page throws here too.
 */
import { fireEvent, installHeadlessEnv } from './env.ts';

installHeadlessEnv();

const { Game } = await import('../src/game/game.ts');

export interface BootResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runBootTests(
  check: (name: string, ok: boolean, detail?: string) => void,
): Promise<void> {
  const doc = (globalThis as unknown as { document: { getElementById(id: string): HTMLElement } })
    .document;

  const game = new Game(doc.getElementById('app'));
  check('game constructs without throwing', true);
  game.start();
  check('game starts', true);

  const anyGame = game as unknown as {
    frame(dt: number): void;
    match: { phase: string; score: number[]; timeLeft: number | null };
    players: { position: { x: number; y: number; z: number }; charge: number }[];
    balls: unknown[];
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
  check('menu renders frames', true);

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
      chaos: mode === 'chaos' ? ['giantball', 'lowgrav', 'turbo'] : [],
    });
    frames(200);
    check(`${mode} mode runs`, anyGame.balls.length > 0, `phase=${anyGame.match.phase}`);
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

  const human = anyGame.players[0];
  const startZ = human.position.z;
  fireEvent('keydown', { code: 'KeyW' });
  fireEvent('keydown', { code: 'ShiftLeft' });
  frames(60);
  fireEvent('keyup', { code: 'KeyW' });
  fireEvent('keyup', { code: 'ShiftLeft' });
  check('WASD moves the human player', Math.abs(human.position.z - startZ) > 1.5,
    `dz=${(human.position.z - startZ).toFixed(2)}`);

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

  // --- UI screens -----------------------------------------------------------
  for (const screen of ['menu', 'play', 'customise', 'settings', 'controls', 'arenas']) {
    anyGame.ui.show(screen);
    frames(3);
  }
  check('every UI screen can be shown', true);
}
