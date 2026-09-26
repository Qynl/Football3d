import * as THREE from 'three';
import { Vec3, clamp, clamp01 } from '../core/math.ts';
import { PhysicsWorld, type CapsuleRef } from '../physics/world.ts';
import { Arena } from '../arenas/arena.ts';
import { getArena, type ArenaDef } from '../arenas/arenaDefs.ts';
import { Ball } from '../ball/ball.ts';
import { BASE, Footballer, defaultModifiers, type FoulInfo, type KickInfo, type PlayerModifiers } from '../player/footballer.ts';
import { getArchetype, type Cosmetics } from '../characters/characterDefs.ts';
import { AIController } from '../ai/aiController.ts';
import { getDifficulty, getPersonality } from '../ai/personalities.ts';
import { CameraRig } from '../camera/cameraRig.ts';
import { Vfx } from '../effects/vfx.ts';
import { AudioEngine } from '../audio/audio.ts';
import { InputManager, type ControlState } from '../input/input.ts';
import { Storage } from '../storage/storage.ts';
import { Ui, type HudState, type StartOptions, type UiHost } from '../ui/ui.tsx';
import {
  MatchManager,
  type GoalInfo,
  type LastTouch,
  type MatchHost,
  type MatchPhase,
} from '../match/matchManager.ts';
import { CHAOS_MODIFIERS, defaultChaosContext, getRules, type GameMode } from '../match/rules.ts';
import { TrainingMode } from '../match/training.ts';
import { ReplayPlayer, ReplayRecorder } from '../effects/replay.ts';
import { DebugDraw } from '../debug/debugDraw.ts';

const FIXED_STEP = 1 / 120;
const MAX_STEPS = 8;

export class Game implements UiHost, MatchHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: CameraRig;
  readonly physics = new PhysicsWorld();
  readonly vfx = new Vfx();
  readonly audio = new AudioEngine();
  readonly input = new InputManager();
  readonly storage = new Storage();
  readonly ui: Ui;
  readonly match: MatchManager;
  readonly debugDraw = new DebugDraw();

  players: Footballer[] = [];
  balls: Ball[] = [];
  arena!: Arena;
  ai: AIController | null = null;
  lastTouch: LastTouch | null = null;
  training: TrainingMode | null = null;

  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private accumulator = 0;
  private lastFrame = performance.now();
  private running = false;
  private paused = false;
  private mode: GameMode = 'quick';
  private options: StartOptions | null = null;
  private recorder = new ReplayRecorder(5);
  private replayPlayer = new ReplayPlayer();
  private modifiers: PlayerModifiers = defaultModifiers();
  private randomBounce = 0;
  private cameraYaw = 0;
  private fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private matchStats = { shots: 0, tackles: 0, slides: 0, fouls: 0, topSpeed: 0, possession: 0 };
  private tmpVec = new Vec3();
  private hudState: HudState = {
    scoreA: 0,
    scoreB: 0,
    nameA: 'YOU',
    nameB: 'CPU',
    time: '0:00',
    urgent: false,
    mode: 'QUICK MATCH',
    charge: 0,
    chargeActive: false,
    curve: 0,
    lob: false,
    stamina: 100,
    aiState: '',
    aiRead: '',
    training: null,
  };

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);

    this.camera = new CameraRig(window.innerWidth / window.innerHeight);

    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x3fa14a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e0, 1.45);
    this.sun.position.set(14, 26, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    const cam = this.sun.shadow.camera;
    cam.left = -26;
    cam.right = 26;
    cam.top = 30;
    cam.bottom = -30;
    cam.near = 1;
    cam.far = 80;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.vfx.group);
    this.scene.add(this.debugDraw.object);

    this.ui = new Ui(this);
    this.match = new MatchManager(this);

    this.buildArena(this.storage.data.loadout.arena);
    this.createEntities();
    this.applySettings();

    this.input.attach(this.renderer.domElement);
    this.bindWindowEvents();

    // Idle menu scene: gentle orbit so the menu is alive.
    this.camera.startCinematic(new THREE.Vector3(0, 1.1, 0), 15);
  }

  // ------------------------------------------------------------ construction

  private buildArena(id: string, defOverride?: ArenaDef): void {
    if (this.arena) {
      this.scene.remove(this.arena.group);
      this.arena.dispose();
    }
    const def = defOverride ?? getArena(id);
    this.arena = new Arena(def);
    this.scene.add(this.arena.group);
    this.arena.applyPhysics(this.physics);
    this.arena.applyLighting(this.scene, this.sun, this.hemi);
    this.vfx.grassColor = def.theme.grassA;
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
  }

  private createEntities(): void {
    const loadout = this.storage.data.loadout;
    for (const p of this.players) {
      this.scene.remove(p.object3D);
      p.rig.dispose();
    }
    this.players = [];
    const events = {
      onKick: (info: KickInfo) => this.handleKick(info),
      onWhiff: (p: Footballer) => {
        this.audio.play('kickQuick', 0.3);
        void p;
      },
      onTouch: (p: Footballer, impact: number) => this.registerTouch(p, impact, false),
      onTackleWin: (p: Footballer) => {
        this.audio.play('tackle');
        this.camera.addShake(0.22);
        this.vfx.impact(p.position.x, 0.4, p.position.z, 2, this.arena.def.theme.grassA);
        if (p.isHuman) this.matchStats.tackles++;
      },
      onSlideStart: (p: Footballer) => {
        this.audio.play('slide');
        if (p.isHuman) {
          this.matchStats.slides++;
          this.ai?.notePlayerSlide();
        }
      },
      onJump: () => this.audio.play('jump'),
      onLand: (p: Footballer, impact: number) => {
        if (impact > 3) {
          this.audio.play('land', clamp01(impact / 12));
          this.vfx.slideDust(p.position.x, p.position.z, impact);
        }
      },
      onBodyHit: (a: Footballer, b: Footballer, strength: number, at: Vec3) => {
        this.audio.play('body', clamp01(strength / 8));
        this.camera.addShake(clamp(strength * 0.035, 0, 0.45));
        this.vfx.impact(at.x, at.y, at.z, clamp(strength * 0.35, 1, 4), 0xffffff);
        if (strength > 6) this.vfx.hitstop(0.045);
        void a;
        void b;
      },
      onFoul: (info: FoulInfo) => {
        this.matchStats.fouls++;
        this.match.reportFoul(info);
      },
    };

    const makePlayer = (
      index: number,
      team: number,
      archetypeId: string,
      cosmetics: Cosmetics,
      isHuman: boolean,
      name: string,
    ) => {
      const f = new Footballer({
        index,
        team,
        archetype: getArchetype(archetypeId),
        cosmetics,
        isHuman,
        events,
        name,
        modifiers: this.modifiers,
      });
      this.scene.add(f.object3D);
      this.players.push(f);
      return f;
    };

    makePlayer(0, 0, loadout.archetype, loadout.cosmetics, true, 'YOU');
    makePlayer(1, 1, loadout.p2Archetype, loadout.p2Cosmetics, false, 'CPU');

    if (this.balls.length === 0) {
      const ball = new Ball(loadout.ball);
      ball.addTo(this.scene);
      this.balls.push(ball);
    }
  }

  private bindWindowEvents(): void {
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.resize(window.innerWidth / window.innerHeight);
    });
    window.addEventListener('keydown', (e) => {
      if (this.input.captureCallback) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.togglePause();
      } else if (e.code === 'F3') {
        e.preventDefault();
        const s = this.storage.data.settings;
        s.debug = !s.debug;
        this.storage.save();
        this.debugDraw.enabled = s.debug;
        this.ui.toast(s.debug ? 'DEBUG ON' : 'DEBUG OFF');
      } else if (e.code === 'KeyR' && this.ui.currentScreen === 'end') {
        this.rematch();
      }
    });
    this.renderer.domElement.addEventListener('mousedown', () => {
      this.audio.init();
      if (this.running && !this.paused && this.mode !== 'local') this.input.requestPointerLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running && !this.paused) this.togglePause();
    });
  }

  // ------------------------------------------------------------------ flow

  startMatch(opts: StartOptions): void {
    this.audio.init();
    this.options = opts;
    this.mode = opts.mode;
    this.lastTouch = null;
    this.matchStats = { shots: 0, tackles: 0, slides: 0, fouls: 0, topSpeed: 0, possession: 0 };

    // Chaos modifiers rewrite the arena definition and physics before anything is built.
    const baseDef = getArena(opts.arenaId);
    const ctx = defaultChaosContext(baseDef);
    if (opts.mode === 'chaos') {
      for (const id of opts.chaos) {
        CHAOS_MODIFIERS.find((m) => m.id === id)?.apply(ctx);
      }
    }
    this.modifiers = ctx.players;
    this.randomBounce = ctx.randomBounce;
    this.buildArena(opts.arenaId, ctx.arena);

    // Rebuild characters with the latest cosmetics/archetypes.
    this.createEntities();
    for (const p of this.players) p.setModifiers(this.modifiers);

    // Balls.
    const wanted = 1 + ctx.extraBalls;
    while (this.balls.length > wanted) {
      const b = this.balls.pop()!;
      this.scene.remove(b.group);
      b.dispose();
    }
    while (this.balls.length < wanted) {
      const b = new Ball(this.storage.data.loadout.ball);
      b.addTo(this.scene);
      this.balls.push(b);
    }
    for (const b of this.balls) {
      b.setDesign(this.storage.data.loadout.ball);
      b.setRadius(ctx.ballRadius);
      b.body.restitution = ctx.ballRestitution;
    }
    this.physics.material.gravity = ctx.gravity;

    // Player two: human in local mode, AI otherwise.
    const p2 = this.players[1];
    p2.isHuman = opts.mode === 'local';
    p2.name = opts.mode === 'local' ? 'P2' : this.aiName(opts);
    this.players[0].name = opts.mode === 'local' ? 'P1' : 'YOU';

    if (!p2.isHuman) {
      this.ai = new AIController(
        p2,
        this.players[0],
        this.balls[0],
        this.arena,
        getDifficulty(opts.difficulty),
        getPersonality(opts.personality),
        Date.now() & 0xffff,
      );
    } else {
      this.ai = null;
    }

    // Training targets.
    if (this.training) {
      this.scene.remove(this.training.group);
      this.training.dispose();
      this.training = null;
    }
    if (opts.mode === 'training') {
      this.training = new TrainingMode(this.arena, this.vfx, this.audio);
      this.scene.add(this.training.group);
      this.training.start();
      this.training.best = this.storage.data.stats.trainingBest;
    }

    this.camera.mode = opts.mode === 'local' ? 'broadcast' : this.storage.data.settings.cameraMode;
    this.camera.stopCinematic();
    this.recorder.reset();
    this.replayPlayer.stop();
    this.vfx.clear();
    this.vfx.clearTimeEffects();

    this.match.start(opts.mode, getRules(opts.rulesId));
    this.camera.snap(this.players[0], this.balls[0]);

    this.running = true;
    this.paused = false;
    this.ui.show('game');
    this.audio.startMusic('match');
    if (opts.mode !== 'local') this.input.requestPointerLock();
  }

  private aiName(opts: StartOptions): string {
    const p = getPersonality(opts.personality);
    return p.name.toUpperCase();
  }

  rematch(): void {
    if (!this.options) return;
    this.startMatch(this.options);
  }

  changeArena(id: string): void {
    if (this.options) this.options.arenaId = id;
  }

  quitToMenu(): void {
    this.running = false;
    this.paused = false;
    this.input.exitPointerLock();
    this.match.phase = 'idle';
    this.vfx.clear();
    this.vfx.clearTimeEffects();
    this.camera.startCinematic(new THREE.Vector3(0, 1.1, 0), 15);
    this.audio.startMusic('menu');
    this.audio.play('uiBack');
    this.ui.show('menu');
  }

  resumeGame(): void {
    if (!this.running) return;
    this.paused = false;
    this.ui.show('game');
    this.audio.play('ui');
    if (this.mode !== 'local') this.input.requestPointerLock();
  }

  togglePause(): void {
    if (!this.running) {
      if (this.ui.currentScreen !== 'menu') this.ui.show('menu');
      return;
    }
    if (this.ui.currentScreen === 'end') return;
    if (this.paused) {
      this.resumeGame();
    } else {
      this.paused = true;
      this.input.exitPointerLock();
      this.ui.show('pause');
      this.audio.play('uiBack');
    }
  }

  applySettings(): void {
    const s = this.storage.data.settings;
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.musicVolume);
    this.input.options.mouseSensitivity = s.mouseSensitivity;
    this.input.options.invertY = s.invertY;
    this.input.bindings = [
      { ...this.storage.data.bindings[0] },
      { ...this.storage.data.bindings[1] },
    ];
    if (this.mode !== 'local') this.camera.mode = s.cameraMode;
    this.camera.shakeScale = s.screenShake;
    this.renderer.shadowMap.enabled = s.shadows;
    const pixelCap = s.quality === 'low' ? 1 : s.quality === 'medium' ? 1.35 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelCap));
    const shadowRes = s.quality === 'low' ? 768 : s.quality === 'medium' ? 1024 : 1536;
    if (this.sun.shadow.mapSize.x !== shadowRes) {
      this.sun.shadow.mapSize.set(shadowRes, shadowRes);
      // The depth target is allocated lazily from mapSize, so it has to be
      // thrown away for a resolution change to actually apply.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.debugDraw.enabled = s.debug;
  }

  applyLoadout(): void {
    const loadout = this.storage.data.loadout;
    this.players[0]?.rig.setCosmetics(loadout.cosmetics);
    this.players[1]?.rig.setCosmetics(loadout.p2Cosmetics);
    if (this.players[0]) this.players[0].archetype = getArchetype(loadout.archetype);
    if (this.players[1]) this.players[1].archetype = getArchetype(loadout.p2Archetype);
    for (const b of this.balls) b.setDesign(loadout.ball);
  }

  // ------------------------------------------------------------- main loop

  start(): void {
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const realDt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.frame(realDt);
    };
    requestAnimationFrame(loop);
  }

  private frame(realDt: number): void {
    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    this.input.update();
    this.ui.tick(realDt);

    const dt = this.vfx.tickTime(realDt);
    const simulating = this.running && !this.paused;

    if (simulating) {
      if (this.replayPlayer.active) {
        this.updateReplay(realDt);
      } else {
        this.simulate(dt);
      }
      this.match.update(dt);
    }

    // Visual updates always run so menus stay alive.
    for (const p of this.players) p.updateVisual(realDt, this.nearestBall(p).body.position);
    for (const b of this.balls) b.update(realDt, 0);
    this.arena.update(realDt, this.crowdHype());
    this.vfx.update(realDt);
    this.training?.update(dt, this.balls);

    this.updateCamera(realDt, simulating);
    this.updateHud();
    this.drawDebug();

    this.renderer.render(this.scene, this.camera.camera);
    this.input.endFrame();
  }

  private crowdHype(): number {
    if (!this.running) return 0.1;
    const phase = this.match.phase;
    if (phase === 'goal' || phase === 'replay') return 1;
    const ballNearGoal = this.balls.some(
      (b) => Math.abs(Math.abs(b.body.position.z) - this.arena.def.halfLength) < 7,
    );
    return ballNearGoal ? 0.45 : 0.12;
  }

  /** Fixed-step simulation: physics, players, AI. */
  private simulate(dt: number): void {
    this.accumulator += dt;
    let steps = 0;
    const humanInput = this.input.get(0);
    const p2Input = this.mode === 'local' ? this.input.get(1) : null;

    // Camera-relative control frame.
    const camDir = new THREE.Vector3();
    this.camera.camera.getWorldDirection(camDir);
    this.cameraYaw = Math.atan2(camDir.x, camDir.z);

    // AI thinks once per frame at render rate (its reaction delay is explicit).
    let aiInput: ControlState | null = null;
    if (this.ai) {
      this.ai.frozen = this.players[1].frozen || this.match.phase === 'countdown';
      this.ai.ball = this.nearestBall(this.players[1]);
      aiInput = this.ai.update(dt);
    }

    const firstStepInputs: ControlState[] = [];
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
      this.accumulator -= FIXED_STEP;
      steps++;
      this.step(FIXED_STEP, humanInput, p2Input, aiInput);
      if (steps === 1) {
        // Edge-triggered inputs must only fire on the first sub-step of a frame.
        for (const s of [humanInput, p2Input, aiInput]) {
          if (!s) continue;
          firstStepInputs.push(s);
          s.kickPressed = false;
          s.jumpPressed = false;
          s.tacklePressed = false;
          s.slidePressed = false;
          s.challengePressed = false;
          s.cameraPressed = false;
        }
      }
    }
    if (steps >= MAX_STEPS) this.accumulator = 0;

    // Camera toggle (handled once per frame).
    if (humanInput.cameraPressed || (p2Input?.cameraPressed ?? false)) {
      this.cycleCamera();
    }

    // Replay recording.
    this.recorder.record(
      dt,
      this.balls[0].body.position,
      this.players.map((p) => ({
        x: p.position.x,
        y: p.position.y,
        z: p.position.z,
        yaw: p.yaw,
        slide: p.pose.slide,
        charge: p.charge,
      })),
    );

    // Adaptation: track possession-ish stats.
    const human = this.players[0];
    this.matchStats.topSpeed = Math.max(
      this.matchStats.topSpeed,
      Math.hypot(human.velocity.x, human.velocity.z),
    );
  }

  private step(dt: number, humanInput: ControlState, p2Input: ControlState | null, aiInput: ControlState | null): void {
    const playable =
      this.match.phase === 'play' ||
      this.match.phase === 'freekick' ||
      this.match.phase === 'penalty-shot' ||
      this.mode === 'training';

    const neutral = InputManager.neutral();
    const camYaw = this.camera.mode === 'broadcast' ? this.cameraYaw : this.cameraYaw;

    this.players[0].setInput(playable ? humanInput : neutral, camYaw);
    if (this.players[1].isHuman) {
      this.players[1].setInput(playable ? (p2Input ?? neutral) : neutral, camYaw);
    } else {
      // The AI steers in world space; it never gets a camera.
      this.players[1].setInput(playable && aiInput ? aiInput : neutral, 0, 'world');
    }

    for (const p of this.players) {
      p.update(dt, this.nearestBall(p), this.arena, this.players);
      this.physics.resolveCapsuleStatics(p.capsule as CapsuleRef);
      for (const ball of this.balls) {
        this.physics.resolveCapsuleAgainstPinnedBall(p.capsule as CapsuleRef, ball.body);
      }
    }

    const capsules = this.players.map((p) => p.capsule);
    for (const ball of this.balls) {
      this.physics.stepBall(ball.body, dt, capsules);
      this.physics.applyRolling(ball.body, dt);
      if (this.randomBounce > 0 && ball.body.grounded && ball.body.speed > 2) {
        ball.body.velocity.x += (Math.random() - 0.5) * 6 * dt * this.randomBounce;
        ball.body.velocity.z += (Math.random() - 0.5) * 6 * dt * this.randomBounce;
      }
    }
    this.drainContacts();

    // Camera aim from mouse / right stick.
    if (this.mode !== 'local') {
      this.camera.aim(humanInput.aimYaw, humanInput.aimPitch);
    }
  }

  private nearestBall(p: Footballer): Ball {
    if (this.balls.length === 1) return this.balls[0];
    let best = this.balls[0];
    let bestD = Infinity;
    for (const b of this.balls) {
      const d = p.position.horizontalDistanceTo(b.body.position);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private drainContacts(): void {
    const contacts = this.physics.contacts;
    for (const c of contacts) {
      switch (c.kind) {
        case 'ground':
          if (c.impact > 1.2) {
            this.audio.play('bounce', clamp01(c.impact / 14));
            this.vfx.impact(c.x, c.y, c.z, clamp(c.impact * 0.22, 0.5, 3), this.arena.def.theme.grassA);
            for (const b of this.balls) if (b.body.position.y < 1) b.impact(clamp01(c.impact / 12));
          }
          break;
        case 'wall':
          this.audio.play('wall', clamp01(c.impact / 16));
          this.vfx.impact(c.x, c.y, c.z, clamp(c.impact * 0.2, 0.5, 3), 0xffffff);
          if (c.impact > 6) this.camera.addShake(0.1);
          if (this.lastTouch) {
            this.lastTouch.wall = true;
            if (this.lastTouch.playerIndex === 0) this.ai?.noteWallRebound();
          }
          break;
        case 'post':
        case 'crossbar': {
          this.audio.play(c.kind === 'post' ? 'post' : 'crossbar', clamp01(c.impact / 18));
          this.camera.addShake(0.4);
          this.vfx.hitstop(0.05);
          this.vfx.shockwave(c.x, c.y, c.z, 0xffffff, 2.2, 0.4, false);
          this.ui.banner(c.kind === 'post' ? 'POST!' : 'CROSSBAR!', '', 900);
          break;
        }
        case 'net':
        case 'goalback':
          this.audio.play('net', clamp01(c.impact / 14));
          break;
        case 'player': {
          const p = this.players[c.playerIndex ?? 0];
          if (p) this.registerTouch(p, c.impact, true);
          this.audio.play('body', clamp01(c.impact / 12));
          break;
        }
      }
    }
    contacts.length = 0;
  }

  private registerTouch(p: Footballer, impact: number, bodyContact: boolean): void {
    const goalZ = p.team === 0 ? this.arena.def.halfLength : -this.arena.def.halfLength;
    const ball = this.nearestBall(p);
    this.lastTouch = {
      playerIndex: p.index,
      team: p.team,
      distance: Math.hypot(ball.body.position.x, goalZ - ball.body.position.z),
      aerial: !p.grounded,
      wall: false,
      speed: impact,
      time: performance.now() / 1000,
    };
    p.timeSinceTouch = 0;
    this.ai?.noteTouch(p.index === 1);
    if (bodyContact) ball.impact(clamp01(impact / 12));
  }

  private handleKick(info: KickInfo): void {
    const p = info.player;
    const power = info.power;
    const strong = info.charge > 0.55;
    this.audio.play(info.quick ? 'kickQuick' : strong ? 'kickPower' : 'kick', clamp01(info.charge));
    this.camera.addShake(clamp(info.charge * 0.55, 0.05, 0.6));
    if (strong) this.vfx.hitstop(0.035);
    this.vfx.kickBurst(info.position.x, 0, info.position.z, power, info.direction.x, info.direction.z);
    this.registerTouch(p, power, false);
    if (p.isHuman) {
      this.matchStats.shots++;
      const goalZ = p.team === 0 ? this.arena.def.halfLength : -this.arena.def.halfLength;
      const dist = Math.hypot(p.position.x, goalZ - p.position.z);
      this.ai?.notePlayerShot(dist, info.lob, info.volley);
    }
  }

  // ---------------------------------------------------------------- camera

  private cycleCamera(): void {
    const order: ('ball' | 'player' | 'broadcast')[] = ['ball', 'player', 'broadcast'];
    const idx = order.indexOf(this.camera.mode);
    this.camera.mode = order[(idx + 1) % order.length];
    if (this.mode !== 'local') {
      this.storage.data.settings.cameraMode = this.camera.mode === 'broadcast' ? 'ball' : this.camera.mode;
      this.storage.save();
    }
    this.ui.toast(`CAMERA: ${this.camera.mode.toUpperCase()}`);
    this.audio.play('ui');
  }

  private updateCamera(dt: number, simulating: boolean): void {
    if (!this.running) {
      this.camera.update(dt, this.players[0], this.balls[0]);
      return;
    }
    if (this.replayPlayer.active) {
      this.camera.update(dt, this.players[0], this.balls[0]);
      return;
    }
    if (!simulating) {
      this.camera.update(dt * 0.35, this.players[0], this.balls[0]);
      return;
    }
    const focus = this.mode === 'local' ? this.players[0] : this.players[0];
    this.camera.update(dt, focus, this.nearestBall(focus));
  }

  // ---------------------------------------------------------------- replay

  startReplay(seconds: number): boolean {
    if (!this.storage.data.settings.showReplays) return false;
    const frames = this.recorder.take(seconds);
    if (frames.length < 6) return false;
    this.replayPlayer.start(frames, 0.45);
    if (!this.replayPlayer.active) return false;
    const last = frames[frames.length - 1];
    this.camera.startCinematic(new THREE.Vector3(last.ballX, 1.4, last.ballZ), 10);
    this.ui.banner('REPLAY', '', 1200);
    return true;
  }

  stopReplay(): void {
    if (!this.replayPlayer.active) {
      this.camera.stopCinematic();
      return;
    }
    this.replayPlayer.stop();
    this.camera.stopCinematic();
  }

  replayActive(): boolean {
    return this.replayPlayer.active;
  }

  private updateReplay(dt: number): void {
    const frame = this.replayPlayer.update(dt);
    if (!frame) return;
    this.balls[0].body.position.set(frame.ballX, frame.ballY, frame.ballZ);
    this.balls[0].group.position.set(frame.ballX, frame.ballY, frame.ballZ);
    for (let i = 0; i < this.players.length; i++) {
      const pf = frame.players[i];
      if (!pf) continue;
      const p = this.players[i];
      p.position.set(pf.x, pf.y, pf.z);
      p.yaw = pf.yaw;
      p.pose.slide = pf.slide;
      p.pose.charge = pf.charge;
    }
  }

  clearBalls(): void {
    for (const b of this.balls) b.reset(0, b.body.radius + 0.02, 0);
  }

  // ------------------------------------------------------------ match hooks

  showBanner(main: string, sub = '', duration = 1400): void {
    this.ui.banner(main, sub, duration);
  }

  onPhaseChange(phase: MatchPhase): void {
    if (phase === 'play') {
      this.camera.stopCinematic();
    }
    if (phase === 'goal') {
      this.camera.startCinematic(
        new THREE.Vector3(this.balls[0].body.position.x, 1.6, this.balls[0].body.position.z),
        8,
      );
    }
    if (phase === 'countdown') {
      this.camera.stopCinematic();
      this.lastTouch = null;
      this.recorder.reset();
    }
  }

  onGoal(info: GoalInfo): void {
    const stats = this.storage.data.stats;
    if (this.mode === 'training') return;
    if (info.team === 0) {
      stats.goals++;
      if (info.distance > stats.bestGoalDistance) stats.bestGoalDistance = info.distance;
      if (info.aerial) stats.aerialGoals++;
      if (info.wall) stats.wallGoals++;
    } else {
      stats.conceded++;
    }
    if (info.ownGoal && info.scorerIndex === 0) stats.ownGoals++;
    this.storage.save();
    this.vfx.slowmo(0.35, 0.5);
  }

  onMatchOver(winner: number | null): void {
    const stats = this.storage.data.stats;
    const score = this.match.score;
    if (this.mode === 'quick' || this.mode === 'chaos' || this.mode === 'penalty') {
      stats.matches++;
      if (winner === 0) stats.wins++;
      else if (winner === 1) stats.losses++;
      else stats.draws++;
    }
    if (this.mode === 'training' && this.training) {
      stats.trainingBest = Math.max(stats.trainingBest, this.training.score);
    }
    this.storage.save();
    this.input.exitPointerLock();

    const title =
      winner === null ? 'DRAW' : winner === 0 ? (this.mode === 'local' ? 'P1 WINS' : 'YOU WIN') : this.mode === 'local' ? 'P2 WINS' : 'YOU LOSE';
    const subtitle =
      winner === 0
        ? 'Clinical. Do it again.'
        : winner === 1
          ? 'The CPU read you. Adjust and go again.'
          : 'Nobody blinked.';
    this.ui.showResult({
      title,
      subtitle,
      scoreLine: `${score[0]} - ${score[1]}`,
      stats: [
        ['Shots', String(this.matchStats.shots)],
        ['Tackles', String(this.matchStats.tackles)],
        ['Slides', String(this.matchStats.slides)],
        ['Fouls', String(this.matchStats.fouls)],
        ['Top speed', `${this.matchStats.topSpeed.toFixed(1)} m/s`],
      ],
    });
    this.audio.setIntensity(0);
  }

  // ------------------------------------------------------------------- hud

  private updateHud(): void {
    if (!this.running) return;
    const s = this.hudState;
    const human = this.players[0];
    s.scoreA = this.match.score[0];
    s.scoreB = this.match.score[1];
    s.nameA = this.players[0].name;
    s.nameB = this.players[1].name;
    s.time = this.mode === 'training' ? 'FREE' : this.match.formattedTime();
    s.urgent = this.match.timeLeft !== null && this.match.timeLeft < 15;
    s.mode =
      this.mode === 'penalty'
        ? `PENALTIES ${this.match.penalty.shots[0]}-${this.match.penalty.shots[1]}`
        : this.match.goldenGoal
          ? 'GOLDEN GOAL'
          : this.modeLabel();
    s.charge = human.charging ? human.charge : human.swingTimer > 0 ? 1 - human.swingTimer / Math.max(0.01, human.swingTotal) : 0;
    s.chargeActive = human.charging;
    s.curve = human.charging ? clamp(this.input.get(0).moveX, -1, 1) : 0;
    s.lob = this.input.get(0).lobHeld;
    s.stamina = human.stamina;
    if (this.ai && this.storage.data.settings.debug) {
      s.aiState = `AI: ${this.ai.state.toUpperCase()}`;
      s.aiRead = this.ai.adaptation.summary();
    } else if (this.ai) {
      s.aiState = '';
      s.aiRead = '';
    }
    s.training = this.training
      ? { score: this.training.score, combo: this.training.combo, last: this.training.lastHitText }
      : null;
    this.ui.updateHud(s);
    this.audio.updateCharge(human.charging ? human.charge : 0);
  }

  private modeLabel(): string {
    switch (this.mode) {
      case 'quick':
        return 'QUICK MATCH';
      case 'training':
        return 'TRAINING';
      case 'local':
        return 'LOCAL 1v1';
      case 'chaos':
        return 'CHAOS';
      case 'penalty':
        return 'PENALTIES';
    }
  }

  // ----------------------------------------------------------------- debug

  private drawDebug(): void {
    const dbg = this.debugDraw;
    dbg.enabled = this.storage.data.settings.debug;
    if (!dbg.enabled) {
      this.ui.setDebug('', false);
      dbg.begin();
      dbg.end();
      return;
    }
    dbg.begin();
    const def = this.arena.def;

    // Goal boundaries.
    for (const side of [-1, 1]) {
      const z = side * def.halfLength;
      dbg.line(-def.goalWidth / 2, 0, z, -def.goalWidth / 2, def.goalHeight, z, 0x00ff88);
      dbg.line(def.goalWidth / 2, 0, z, def.goalWidth / 2, def.goalHeight, z, 0x00ff88);
      dbg.line(-def.goalWidth / 2, def.goalHeight, z, def.goalWidth / 2, def.goalHeight, z, 0x00ff88);
    }

    // Players.
    for (const p of this.players) {
      const color = p.isHuman ? 0x4dd4ac : 0xff6b6b;
      dbg.capsule(p.position.x, p.position.y, p.position.z, p.capsule.radius, p.capsule.height, color);
      const f = p.facing(this.tmpVec);
      dbg.arrow(p.position.x, 0.1, p.position.z, f.x * 1.6, 0, f.z * 1.6, 0xffff00);
      // Kick reach.
      dbg.circle(p.position.x + f.x * 0.32, 0.06, p.position.z + f.z * 0.32, (BASE.kickReach * p.archetype.reach + this.balls[0].body.radius), 0xffaa00, 20);
      // Tackle area.
      if (p.tackleTimer > 0) {
        dbg.circle(p.position.x + f.x * 0.9, 0.08, p.position.z + f.z * 0.9, 1.3, 0xff0000, 16);
      }
      if (p.slideTimer > 0) {
        dbg.circle(p.position.x + f.x * 0.55, 0.08, p.position.z + f.z * 0.55, 1.25, 0xff00ff, 16);
      }
    }

    // Ball + velocity + predicted path.
    for (const b of this.balls) {
      const pos = b.body.position;
      dbg.sphere(pos.x, pos.y, pos.z, b.body.radius, 0xffffff);
      dbg.arrow(pos.x, pos.y, pos.z, b.body.velocity.x * 0.15, b.body.velocity.y * 0.15, b.body.velocity.z * 0.15, 0x00ffff);
      dbg.arrow(pos.x, pos.y, pos.z, b.body.spin.x * 0.03, b.body.spin.y * 0.03, b.body.spin.z * 0.03, 0xff00ff);
    }

    // AI target + state.
    if (this.ai) {
      const aiPos = this.players[1].position;
      dbg.circle(aiPos.x, 0.12, aiPos.z, 0.6, 0xff6b6b, 14);
    }

    dbg.end();

    const b = this.balls[0].body;
    const human = this.players[0];
    const lines = [
      `FPS         ${this.fps.toFixed(0)}`,
      `phase       ${this.match.phase}`,
      `timeScale   ${this.vfx.timeScale.toFixed(2)}`,
      `ball pos    ${b.position.x.toFixed(2)} ${b.position.y.toFixed(2)} ${b.position.z.toFixed(2)}`,
      `ball vel    ${b.velocity.length().toFixed(2)} m/s`,
      `ball spin   ${b.spin.length().toFixed(1)} rad/s`,
      `grounded    ${b.grounded}`,
      `player vel  ${Math.hypot(human.velocity.x, human.velocity.z).toFixed(2)}`,
      `player st   ${human.state}`,
      `charge      ${human.charge.toFixed(2)}`,
      `stamina     ${human.stamina.toFixed(0)}`,
      `lastTouch   ${this.lastTouch ? `P${this.lastTouch.playerIndex} d=${this.lastTouch.distance.toFixed(1)}m wall=${this.lastTouch.wall}` : '-'}`,
    ];
    if (this.ai) {
      lines.push(
        `ai state    ${this.ai.state}`,
        `ai reads    ${this.ai.adaptation.summary()}`,
        ...Object.entries(this.ai.debugScores).map(([k, v]) => `  ${k.padEnd(10)}${v.toFixed(2)}`),
      );
    }
    this.ui.setDebug(lines.join('\n'), true);
  }
}
