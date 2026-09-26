import { installHeadlessEnv } from './env.ts';

installHeadlessEnv();

const { Arena } = await import('../src/arenas/arena.ts');
const { getArena } = await import('../src/arenas/arenaDefs.ts');
const { PhysicsWorld } = await import('../src/physics/world.ts');
const { Ball } = await import('../src/ball/ball.ts');
const { Footballer } = await import('../src/player/footballer.ts');
const { getArchetype, DEFAULT_COSMETICS, AI_COSMETICS } = await import('../src/characters/characterDefs.ts');
const { AIController } = await import('../src/ai/aiController.ts');
const { getDifficulty, getPersonality } = await import('../src/ai/personalities.ts');
const { MatchManager } = await import('../src/match/matchManager.ts');
const { getRules } = await import('../src/match/rules.ts');
const { AudioEngine } = await import('../src/audio/audio.ts');
const { Vfx } = await import('../src/effects/vfx.ts');
const { CameraRig } = await import('../src/camera/cameraRig.ts');
const { InputManager } = await import('../src/input/input.ts');

type ArenaT = InstanceType<typeof Arena>;
type BallT = InstanceType<typeof Ball>;
type FootballerT = InstanceType<typeof Footballer>;
type AIT = InstanceType<typeof AIController>;
type MatchT = InstanceType<typeof MatchManager>;
type ControlStateT = ReturnType<typeof InputManager.neutral>;

export interface SimOptions {
  arena?: string;
  difficulty?: string;
  personality?: string;
  /** Give player 1 an AI brain. */
  ai?: boolean;
  /** Give player 0 an AI brain too (AI vs AI soak tests). */
  aiBoth?: boolean;
  rules?: string;
  mode?: 'quick' | 'training' | 'penalty' | 'local' | 'chaos';
  seed?: number;
}

export const FIXED = 1 / 120;

export class Sim {
  arena: ArenaT;
  physics = new PhysicsWorld();
  balls: BallT[] = [];
  players: FootballerT[] = [];
  ai: AIT | null = null;
  ai0: AIT | null = null;
  match: MatchT;
  audio = new AudioEngine();
  vfx = new Vfx();
  camera = new CameraRig(1.6);
  lastTouch: unknown = null;
  banners: { main: string; sub: string }[] = [];
  goals: unknown[] = [];
  fouls: unknown[] = [];
  kicks: unknown[] = [];
  matchOverWinner: number | null | undefined = undefined;
  phaseLog: string[] = [];
  time = 0;

  constructor(opts: SimOptions = {}) {
    this.arena = new Arena(getArena(opts.arena ?? 'classic'));
    this.arena.applyPhysics(this.physics);
    const ball = new Ball('classic');
    this.balls.push(ball);

    const events = {
      onKick: (info: unknown) => this.kicks.push(info),
      onFoul: (info: unknown) => {
        this.fouls.push(info);
        this.match.reportFoul(info as never);
      },
      onTouch: (p: FootballerT, impact: number) => this.registerTouch(p, impact),
      onTackleWin: (p: FootballerT) => this.registerTouch(p, 8),
    };

    this.players.push(
      new Footballer({
        index: 0,
        team: 0,
        archetype: getArchetype('balanced'),
        cosmetics: DEFAULT_COSMETICS,
        isHuman: true,
        events,
        name: 'YOU',
      }),
    );
    this.players.push(
      new Footballer({
        index: 1,
        team: 1,
        archetype: getArchetype('balanced'),
        cosmetics: AI_COSMETICS,
        isHuman: false,
        events,
        name: 'CPU',
      }),
    );

    const host = {
      players: this.players,
      balls: this.balls,
      arena: this.arena,
      audio: this.audio,
      vfx: this.vfx,
      camera: this.camera,
      get lastTouch() {
        return simSelf.lastTouch;
      },
      showBanner: (main: string, sub = '') => {
        this.banners.push({ main, sub });
      },
      onGoal: (info: unknown) => this.goals.push(info),
      onMatchOver: (winner: number | null) => {
        this.matchOverWinner = winner;
      },
      onPhaseChange: (phase: string) => this.phaseLog.push(phase),
      startReplay: () => false,
      stopReplay: () => undefined,
      replayActive: () => false,
      clearBalls: () => undefined,
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const simSelf = this;
    this.match = new MatchManager(host as never);

    if (opts.ai !== false) {
      this.ai = new AIController(
        this.players[1],
        this.players[0],
        this.balls[0],
        this.arena,
        getDifficulty(opts.difficulty ?? 'normal'),
        getPersonality(opts.personality ?? 'balanced'),
        opts.seed ?? 4242,
      );
    }
    if (opts.aiBoth) {
      this.ai0 = new AIController(
        this.players[0],
        this.players[1],
        this.balls[0],
        this.arena,
        getDifficulty(opts.difficulty ?? 'normal'),
        getPersonality(opts.personality ?? 'balanced'),
        (opts.seed ?? 4242) + 7,
      );
    }
    this.match.start(opts.mode ?? 'quick', getRules(opts.rules ?? 'classic'));
  }

  private registerTouch(p: FootballerT, impact: number): void {
    const goalZ = p.team === 0 ? this.arena.def.halfLength : -this.arena.def.halfLength;
    this.lastTouch = {
      playerIndex: p.index,
      team: p.team,
      distance: Math.hypot(this.balls[0].body.position.x, goalZ - this.balls[0].body.position.z),
      aerial: !p.grounded,
      wall: false,
      speed: impact,
      time: this.time,
    };
  }

  static input(): ControlStateT {
    return InputManager.neutral();
  }

  /** Advance the simulation by one fixed step with explicit inputs. */
  step(inputs: [ControlStateT, ControlStateT], dt = FIXED): void {
    this.time += dt;
    const playable =
      this.match.phase === 'play' ||
      this.match.phase === 'freekick' ||
      this.match.phase === 'penalty-shot';

    const aiInput0 = this.ai0 ? this.ai0.update(dt) : null;
    const aiInput1 = this.ai ? this.ai.update(dt) : null;
    const neutral = InputManager.neutral();

    const p0 = this.ai0 ? aiInput0! : inputs[0];
    const p1 = this.ai ? aiInput1! : inputs[1];
    this.players[0].setInput(playable ? p0 : neutral, 0);
    this.players[1].setInput(playable ? p1 : neutral, 0);

    for (const p of this.players) {
      p.update(dt, this.balls[0], this.arena, this.players);
      this.physics.resolveCapsuleStatics(p.capsule);
    }
    const capsules = this.players.map((p) => p.capsule);
    for (const ball of this.balls) {
      this.physics.stepBall(ball.body, dt, capsules);
      this.physics.applyRolling(ball.body, dt);
    }
    // Consume wall contacts for shot context.
    for (const c of this.physics.contacts) {
      if (c.kind === 'player' && c.playerIndex !== undefined) {
        this.registerTouch(this.players[c.playerIndex], c.impact);
      }
      if (c.kind === 'wall' && this.lastTouch) {
        (this.lastTouch as { wall: boolean }).wall = true;
      }
    }
    this.physics.contacts.length = 0;
    this.match.update(dt);

    // Edge inputs only fire once.
    for (const s of [inputs[0], inputs[1]]) {
      s.kickPressed = false;
      s.jumpPressed = false;
      s.tacklePressed = false;
      s.slidePressed = false;
      s.challengePressed = false;
    }
  }

  /** Run for `seconds`, optionally driving inputs each step. */
  run(
    seconds: number,
    driver?: (t: number, inputs: [ControlStateT, ControlStateT], sim: Sim) => void,
  ): void {
    const steps = Math.round(seconds / FIXED);
    const inputs: [ControlStateT, ControlStateT] = [InputManager.neutral(), InputManager.neutral()];
    // `t` is elapsed time within this run() call, which makes tests readable.
    for (let i = 0; i < steps; i++) {
      driver?.(i * FIXED, inputs, this);
      this.step(inputs);
    }
  }

  /** Skip the kickoff countdown so tests can get straight to gameplay. */
  skipCountdown(): void {
    let guard = 0;
    while (this.match.phase === 'countdown' && guard++ < 1000) {
      this.step([InputManager.neutral(), InputManager.neutral()]);
    }
  }

  get ball(): BallT {
    return this.balls[0];
  }
}
