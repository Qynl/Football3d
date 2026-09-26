import { clamp, lerp } from '../core/math.ts';
import type { Ball } from '../ball/ball.ts';
import type { Arena } from '../arenas/arena.ts';
import type { Footballer, FoulInfo } from '../player/footballer.ts';
import type { AudioEngine } from '../audio/audio.ts';
import type { Vfx } from '../effects/vfx.ts';
import type { CameraRig } from '../camera/cameraRig.ts';
import type { GameMode, MatchRules } from './rules.ts';

export type MatchPhase =
  | 'idle'
  | 'countdown'
  | 'play'
  | 'goal'
  | 'replay'
  | 'foul'
  | 'freekick'
  | 'penalty-setup'
  | 'penalty-shot'
  | 'over';

export interface GoalInfo {
  team: number;
  scorerIndex: number;
  ownGoal: boolean;
  distance: number;
  aerial: boolean;
  wall: boolean;
  speed: number;
  x: number;
  y: number;
  z: number;
  spectacular: boolean;
}

export interface LastTouch {
  playerIndex: number;
  team: number;
  /** Distance from the target goal when the shot was struck. */
  distance: number;
  aerial: boolean;
  wall: boolean;
  speed: number;
  time: number;
}

export interface MatchHost {
  players: Footballer[];
  balls: Ball[];
  arena: Arena;
  audio: AudioEngine;
  vfx: Vfx;
  camera: CameraRig;
  lastTouch: LastTouch | null;
  showBanner(main: string, sub?: string, duration?: number): void;
  onGoal(info: GoalInfo): void;
  onMatchOver(winner: number | null): void;
  onPhaseChange(phase: MatchPhase): void;
  startReplay(seconds: number): boolean;
  stopReplay(): void;
  replayActive(): boolean;
  clearBalls(): void;
}

const KICKOFF_COUNTDOWN = 3.1;
const RESTART_COUNTDOWN = 2.1;

/** Owns the flow of a match: countdown, goals, fouls, free kicks, endings. */
export class MatchManager {
  phase: MatchPhase = 'idle';
  score: [number, number] = [0, 0];
  timeLeft: number | null = null;
  rules!: MatchRules;
  mode: GameMode = 'quick';
  goldenGoal = false;
  /** Seconds remaining in the current non-play phase. */
  phaseTimer = 0;
  private countdownSpoken = -1;
  private host: MatchHost;
  private kickoffTeam = 0;
  private freeKickTaker = 0;
  private freeKickSpot = { x: 0, z: 0 };
  private lastGoal: GoalInfo | null = null;
  private pendingRestart = 0;
  penalty = {
    round: 0,
    shooter: 0,
    shots: [0, 0],
    attempts: [0, 0],
    maxRounds: 5,
    timer: 0,
    resolved: false,
  };
  matchTimeElapsed = 0;

  constructor(host: MatchHost) {
    this.host = host;
  }

  start(mode: GameMode, rules: MatchRules): void {
    this.mode = mode;
    this.rules = rules;
    this.score = [0, 0];
    this.goldenGoal = false;
    this.timeLeft = rules.duration;
    this.matchTimeElapsed = 0;
    this.lastGoal = null;
    this.penalty = {
      round: 0,
      shooter: 0,
      shots: [0, 0],
      attempts: [0, 0],
      maxRounds: 5,
      timer: 0,
      resolved: false,
    };
    if (mode === 'penalty') {
      this.setupPenalty(0);
      return;
    }
    if (mode === 'training') {
      this.setPhase('play');
      this.resetPositions(0, true);
      this.host.showBanner('TRAINING', 'Free play - hit the targets', 1400);
      return;
    }
    this.kickoffTeam = 0;
    this.beginCountdown(KICKOFF_COUNTDOWN);
  }

  private setPhase(p: MatchPhase): void {
    this.phase = p;
    this.host.onPhaseChange(p);
  }

  private beginCountdown(duration: number): void {
    this.resetPositions(this.kickoffTeam, true);
    this.phaseTimer = duration;
    this.countdownSpoken = -1;
    this.setPhase('countdown');
    this.freezeAll(true);
  }

  private freezeAll(frozen: boolean): void {
    for (const p of this.host.players) p.frozen = frozen;
  }

  /** Puts everyone back at their kickoff spots. */
  resetPositions(kickoffTeam: number, resetBall: boolean): void {
    const arena = this.host.arena;
    const hl = arena.def.halfLength;
    const players = this.host.players;
    for (const p of players) {
      const dir = p.team === 0 ? 1 : -1;
      const own = p.team === 0 ? -hl : hl;
      const kicking = p.team === kickoffTeam;
      const z = kicking ? own + dir * (hl - 1.6) : own + dir * hl * 0.42;
      const x = kicking ? 0.9 * (p.team === 0 ? -1 : 1) : 0;
      p.teleport(x, z, p.team === 0 ? 0 : Math.PI);
      p.stopCelebrating();
    }
    if (resetBall) {
      for (let i = 0; i < this.host.balls.length; i++) {
        const b = this.host.balls[i];
        const offset = i === 0 ? 0 : (i % 2 === 1 ? 3.2 : -3.2);
        b.reset(offset, b.body.radius + 0.02, 0);
      }
    }
  }

  update(dt: number): void {
    const host = this.host;
    if (this.phase === 'idle') return;
    this.matchTimeElapsed += dt;

    switch (this.phase) {
      case 'countdown': {
        this.phaseTimer -= dt;
        const secs = Math.ceil(this.phaseTimer - 0.1);
        if (secs !== this.countdownSpoken && secs > 0) {
          this.countdownSpoken = secs;
          host.showBanner(String(secs), '', 700);
          host.audio.play('count');
        }
        if (this.phaseTimer <= 0) {
          host.showBanner('KICK OFF!', '', 800);
          host.audio.play('countGo');
          host.audio.play('whistle');
          this.freezeAll(false);
          this.setPhase('play');
        }
        break;
      }
      case 'play': {
        if (this.timeLeft !== null) {
          this.timeLeft = Math.max(0, this.timeLeft - dt);
          if (this.timeLeft <= 0) this.handleTimeUp();
        }
        this.checkGoals();
        break;
      }
      case 'goal': {
        this.phaseTimer -= dt;
        this.checkGoals();
        if (this.phaseTimer <= 0) this.afterGoal();
        break;
      }
      case 'replay': {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0 || !host.replayActive()) {
          host.stopReplay();
          this.afterGoal();
        }
        break;
      }
      case 'foul': {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.setupFreeKick();
        break;
      }
      case 'freekick': {
        this.phaseTimer -= dt;
        const ball = host.balls[0];
        const moved =
          Math.hypot(ball.body.position.x - this.freeKickSpot.x, ball.body.position.z - this.freeKickSpot.z) > 0.55;
        if (moved || this.phaseTimer <= 0) {
          for (const p of host.players) p.frozen = false;
          this.setPhase('play');
          if (!moved) host.showBanner('PLAY ON', '', 700);
        }
        this.checkGoals();
        break;
      }
      case 'penalty-setup': {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.freezeAll(false);
          this.penalty.timer = 8;
          this.penalty.resolved = false;
          this.setPhase('penalty-shot');
          host.audio.play('whistle');
        }
        break;
      }
      case 'penalty-shot': {
        this.updatePenalty(dt);
        break;
      }
      case 'over':
        break;
    }

    if (this.pendingRestart > 0) {
      this.pendingRestart -= dt;
      if (this.pendingRestart <= 0) {
        this.pendingRestart = 0;
        this.beginCountdown(RESTART_COUNTDOWN);
      }
    }

    // Music intensity ramps in the closing seconds and when it is tight.
    if (this.phase === 'play') {
      let intensity = 0.25;
      if (this.timeLeft !== null && this.rules.duration) {
        intensity += clamp(1 - this.timeLeft / Math.min(45, this.rules.duration), 0, 1) * 0.55;
      }
      if (this.goldenGoal) intensity = 1;
      const diff = Math.abs(this.score[0] - this.score[1]);
      intensity += diff === 0 ? 0.18 : 0;
      host.audio.setIntensity(clamp(intensity, 0, 1));
    }
  }

  // ------------------------------------------------------------------ goals

  private checkGoals(): void {
    const host = this.host;
    const def = host.arena.def;
    for (const ball of host.balls) {
      const b = ball.body;
      for (const side of [-1, 1] as const) {
        const line = side * def.halfLength;
        const prevZ = b.prevPosition.z;
        const nowZ = b.position.z;
        const crossed = side < 0 ? prevZ >= line && nowZ < line : prevZ <= line && nowZ > line;
        if (!crossed) continue;
        const denom = nowZ - prevZ;
        const t = Math.abs(denom) < 1e-6 ? 0 : (line - prevZ) / denom;
        const x = lerp(b.prevPosition.x, b.position.x, t);
        const y = lerp(b.prevPosition.y, b.position.y, t);
        if (Math.abs(x) > def.goalWidth / 2 - b.radius * 0.15) continue;
        if (y > def.goalHeight + def.postRadius - b.radius * 0.2) continue;
        this.scoreGoal(side > 0 ? 0 : 1, ball, x, y, line);
        return;
      }
    }
  }

  private scoreGoal(team: number, ball: Ball, x: number, y: number, z: number): void {
    const host = this.host;
    if (this.mode === 'penalty') {
      this.resolvePenalty(true);
      return;
    }
    const touch = host.lastTouch;
    const ownGoal = !!touch && touch.team !== team;
    const info: GoalInfo = {
      team,
      scorerIndex: touch?.playerIndex ?? -1,
      ownGoal,
      distance: touch?.distance ?? 0,
      aerial: touch?.aerial ?? false,
      wall: touch?.wall ?? false,
      speed: ball.body.speed,
      x,
      y,
      z,
      spectacular: false,
    };
    info.spectacular =
      info.distance > 12 ||
      info.aerial ||
      info.wall ||
      ownGoal ||
      (this.timeLeft !== null && this.timeLeft < 10) ||
      ball.body.speed > 26;

    if (this.mode !== 'training') this.score[team]++;
    this.lastGoal = info;
    this.kickoffTeam = team === 0 ? 1 : 0;

    const color = team === 0 ? 0x4dd4ac : 0xff6b6b;
    host.vfx.goalExplosion(x, Math.max(0.6, y), z, color);
    host.vfx.confetti(x * 0.5, z * 0.6, color);
    host.audio.play('goal');
    host.audio.goalSting();
    host.camera.addShake(0.9);
    host.vfx.hitstop(0.14);

    // Everyone stops; the scorer celebrates.
    for (const p of host.players) {
      p.frozen = true;
      p.charging = false;
    }
    const scorer = host.players.find((p) => p.index === info.scorerIndex);
    if (scorer && !ownGoal) scorer.celebrate(scorer.isHuman ? 'jump' : 'fistpump');

    const sub = this.goalSubtitle(info);
    host.showBanner(ownGoal ? 'OWN GOAL!' : 'GOAL!', sub, 1800);
    host.onGoal(info);

    this.phaseTimer = 2.0;
    this.setPhase('goal');
  }

  private goalSubtitle(info: GoalInfo): string {
    const who = info.team === 0 ? this.host.players[0].name : this.host.players[1].name;
    if (info.ownGoal) return `${this.host.players[info.scorerIndex]?.name ?? '?'} put it in their own net`;
    const bits: string[] = [];
    if (info.aerial) bits.push('aerial strike');
    if (info.wall) bits.push('off the wall');
    if (info.distance > 12) bits.push(`${info.distance.toFixed(0)}m screamer`);
    if (info.speed > 26) bits.push(`${info.speed.toFixed(0)} m/s`);
    return bits.length ? `${who} - ${bits.join(', ')}` : `${who} scores`;
  }

  private afterGoal(): void {
    const host = this.host;
    const info = this.lastGoal;
    if (
      info &&
      info.spectacular &&
      this.phase === 'goal' &&
      host.startReplay(2.6)
    ) {
      this.phaseTimer = 3.2;
      this.setPhase('replay');
      return;
    }
    host.stopReplay();
    for (const p of host.players) p.stopCelebrating();

    if (this.isMatchOver()) {
      this.endMatch();
      return;
    }
    if (this.goldenGoal) {
      this.endMatch();
      return;
    }
    this.beginCountdown(RESTART_COUNTDOWN);
  }

  private isMatchOver(): boolean {
    if (this.mode === 'training') return false;
    if (this.rules.goalTarget !== null) {
      if (this.score[0] >= this.rules.goalTarget || this.score[1] >= this.rules.goalTarget) return true;
    }
    if (this.timeLeft !== null && this.timeLeft <= 0 && this.score[0] !== this.score[1]) return true;
    return false;
  }

  private handleTimeUp(): void {
    if (this.score[0] === this.score[1]) {
      if (this.rules.goldenGoal) {
        this.goldenGoal = true;
        this.timeLeft = null;
        this.host.showBanner('GOLDEN GOAL', 'Next goal wins', 2200);
        this.host.audio.play('whistle');
      } else {
        this.endMatch();
      }
    } else {
      this.endMatch();
    }
  }

  private endMatch(): void {
    const host = this.host;
    host.audio.play('whistle');
    this.freezeAll(true);
    const winner =
      this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1;
    if (winner !== null) {
      const w = host.players.find((p) => p.team === winner);
      w?.celebrate(w.isHuman ? 'dance' : 'spin');
    }
    this.setPhase('over');
    host.onMatchOver(winner);
  }

  // ------------------------------------------------------------------ fouls

  reportFoul(info: FoulInfo): void {
    if (this.phase !== 'play' && this.phase !== 'freekick') return;
    if (this.mode === 'penalty') return;
    const host = this.host;
    host.audio.play('foul');
    host.camera.addShake(0.35);
    host.vfx.hitstop(0.08);
    host.showBanner('FOUL', `${info.offender.name} caught ${info.victim.name}`, 1100);
    this.freeKickTaker = info.victim.index;
    const arena = host.arena.def;
    // Keep the spot sane: never inside the goal area, never against a wall.
    const x = clamp(info.position.x, -arena.halfWidth + 1.6, arena.halfWidth - 1.6);
    const z = clamp(info.position.z, -arena.halfLength + 2.6, arena.halfLength - 2.6);
    this.freeKickSpot = { x, z };
    this.phaseTimer = 1.0;
    this.freezeAll(true);
    this.setPhase('foul');
  }

  private setupFreeKick(): void {
    const host = this.host;
    const taker = host.players.find((p) => p.index === this.freeKickTaker) ?? host.players[0];
    const other = host.players.find((p) => p.index !== this.freeKickTaker) ?? host.players[1];
    const attackDir = taker.team === 0 ? 1 : -1;
    const spot = this.freeKickSpot;
    host.balls[0].reset(spot.x, host.balls[0].body.radius + 0.02, spot.z);
    for (let i = 1; i < host.balls.length; i++) {
      host.balls[i].reset(spot.x + (i % 2 ? 4 : -4), host.balls[i].body.radius + 0.02, spot.z);
    }
    taker.teleport(spot.x, spot.z - attackDir * 1.25, taker.team === 0 ? 0 : Math.PI);
    // Defender must retreat.
    const defX = clamp(spot.x * 0.6, -host.arena.def.halfWidth + 1, host.arena.def.halfWidth - 1);
    other.teleport(defX, spot.z + attackDir * 3.6, other.team === 0 ? 0 : Math.PI);
    taker.frozen = false;
    other.frozen = true;
    this.phaseTimer = 5;
    this.setPhase('freekick');
    host.showBanner('FREE KICK', `${taker.name} to take it`, 1200);
  }

  // --------------------------------------------------------------- penalties

  private setupPenalty(shooter: number): void {
    const host = this.host;
    const arena = host.arena.def;
    this.penalty.shooter = shooter;
    const shooterPlayer = host.players[shooter];
    const keeper = host.players[shooter === 0 ? 1 : 0];
    const attackDir = shooterPlayer.team === 0 ? 1 : -1;
    const goalZ = shooterPlayer.team === 0 ? arena.halfLength : -arena.halfLength;
    const spotZ = goalZ - attackDir * 6.2;
    host.balls[0].reset(0, host.balls[0].body.radius + 0.02, spotZ);
    shooterPlayer.teleport(0, spotZ - attackDir * 1.5, attackDir > 0 ? 0 : Math.PI);
    keeper.teleport(0, goalZ - attackDir * 0.55, attackDir > 0 ? Math.PI : 0);
    this.freezeAll(true);
    this.phaseTimer = 1.6;
    this.setPhase('penalty-setup');
    host.showBanner(
      `PENALTY ${this.penalty.round + 1}`,
      `${shooterPlayer.name} shoots - ${keeper.name} in goal`,
      1400,
    );
  }

  private updatePenalty(dt: number): void {
    const host = this.host;
    const arena = host.arena.def;
    const shooter = host.players[this.penalty.shooter];
    const keeper = host.players[this.penalty.shooter === 0 ? 1 : 0];
    const attackDir = shooter.team === 0 ? 1 : -1;
    const goalZ = shooter.team === 0 ? arena.halfLength : -arena.halfLength;
    // Keeper is pinned to the goal line area.
    keeper.position.x = clamp(keeper.position.x, -arena.goalWidth / 2 - 0.6, arena.goalWidth / 2 + 0.6);
    const minZ = Math.min(goalZ - attackDir * 1.5, goalZ + attackDir * 0.3);
    const maxZ = Math.max(goalZ - attackDir * 1.5, goalZ + attackDir * 0.3);
    keeper.position.z = clamp(keeper.position.z, minZ, maxZ);

    this.penalty.timer -= dt;
    const ball = host.balls[0];
    this.checkGoals();
    if (this.penalty.resolved) return;

    const beyondLine = (ball.body.position.z - goalZ) * attackDir > 0.5;
    const stopped = ball.body.speed < 0.7 && ball.body.grounded;
    const movedAway = Math.abs(ball.body.position.z - (goalZ - attackDir * 6.2)) > 1.2;
    if (beyondLine || (stopped && movedAway) || this.penalty.timer <= 0) {
      this.resolvePenalty(false);
    }
  }

  private resolvePenalty(scored: boolean): void {
    if (this.penalty.resolved) return;
    this.penalty.resolved = true;
    const host = this.host;
    const shooter = this.penalty.shooter;
    this.penalty.attempts[shooter]++;
    if (scored) {
      this.penalty.shots[shooter]++;
      this.score[shooter]++;
      host.audio.play('goal');
      host.vfx.goalExplosion(
        host.balls[0].body.position.x,
        1,
        host.balls[0].body.position.z,
        shooter === 0 ? 0x4dd4ac : 0xff6b6b,
      );
      host.showBanner('SCORED!', `${host.players[shooter].name} converts`, 1400);
    } else {
      host.audio.play('save');
      host.showBanner('MISSED!', `${host.players[shooter].name} blows it`, 1400);
    }
    this.freezeAll(true);
    window.setTimeout(() => this.nextPenalty(), 1500);
  }

  private nextPenalty(): void {
    if (this.phase === 'over' || this.phase === 'idle') return;
    const p = this.penalty;
    const next = p.shooter === 0 ? 1 : 0;
    if (next === 0) p.round++;
    // Decide if the duel is already over.
    const remaining0 = Math.max(0, p.maxRounds - p.attempts[0]);
    const remaining1 = Math.max(0, p.maxRounds - p.attempts[1]);
    const decided =
      (p.shots[0] > p.shots[1] + remaining1 || p.shots[1] > p.shots[0] + remaining0) &&
      p.attempts[0] + p.attempts[1] >= 2;
    const finished = p.attempts[0] >= p.maxRounds && p.attempts[1] >= p.maxRounds;
    if (decided || (finished && p.shots[0] !== p.shots[1])) {
      this.endMatch();
      return;
    }
    this.setupPenalty(next);
  }

  // ---------------------------------------------------------------- helpers

  requestKickoff(team: number): void {
    this.kickoffTeam = team;
    this.beginCountdown(RESTART_COUNTDOWN);
  }

  formattedTime(): string {
    if (this.timeLeft === null) return this.goldenGoal ? 'GOLDEN' : '--:--';
    const total = Math.ceil(this.timeLeft);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
