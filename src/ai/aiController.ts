import { Rng, Vec3, angleDelta, clamp, clamp01, lerp, yawFromDirection } from '../core/math.ts';
import type { ControlState } from '../input/input.ts';
import type { Footballer } from '../player/footballer.ts';
import { BASE } from '../player/footballer.ts';
import type { Ball } from '../ball/ball.ts';
import type { Arena } from '../arenas/arena.ts';
import {
  DelayedPerception,
  findInterception,
  predictTrajectory,
  type BallSample,
  type TrajectoryPoint,
} from './perception.ts';
import type { Difficulty, Personality } from './personalities.ts';
import { Adaptation } from './adaptation.ts';

export type AIState =
  | 'kickoff'
  | 'chase'
  | 'intercept'
  | 'attack'
  | 'shoot'
  | 'defend'
  | 'pressure'
  | 'clear'
  | 'aerial'
  | 'recover'
  | 'reposition';

interface KickPlan {
  dir: Vec3;
  charge: number;
  lob: boolean;
  /** Extra sideways input to bend the shot. */
  curve: number;
}

function blankState(): ControlState {
  return {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jumpPressed: false,
    kickHeld: false,
    kickPressed: false,
    kickReleased: false,
    tacklePressed: false,
    slidePressed: false,
    challengePressed: false,
    lobHeld: false,
    cameraPressed: false,
    aimYaw: 0,
    aimPitch: 0,
    active: true,
  };
}

/**
 * Utility-scored state machine with steering behaviours.
 * The controller only emits the same ControlState a human produces, so the AI is
 * bound by identical physics, speeds, cooldowns and charge times.
 */
export class AIController {
  readonly perception = new DelayedPerception();
  readonly adaptation = new Adaptation();
  state: AIState = 'kickoff';
  stateTime = 0;
  private out = blankState();
  private rng: Rng;
  private decisionTimer = 0;
  private hesitation = 0;
  private plan: KickPlan | null = null;
  private traj: TrajectoryPoint[] = [];
  private sample: BallSample = { t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private perceivedBall = new Vec3();
  private perceivedVel = new Vec3();
  private target = new Vec3();
  private tmp = new Vec3();
  private jumpArmed = false;
  private chargingPlan = false;
  /** Rate limiter so physical challenges are considered a few times a second, not 120. */
  private actionCooldown = 0;
  private planAge = 0;
  /** Detects the ball being pinned (usually in a corner) so the AI stops dithering. */
  private stuckTimer = 0;
  private stuckAnchor = new Vec3();
  private lastTouchWasMine = false;
  private wallTargetSign = 1;
  /** Debug snapshot. */
  debugScores: Record<string, number> = {};
  frozen = false;

  self: Footballer;
  opponent: Footballer;
  ball: Ball;
  arena: Arena;
  difficulty: Difficulty;
  personality: Personality;

  constructor(
    self: Footballer,
    opponent: Footballer,
    ball: Ball,
    arena: Arena,
    difficulty: Difficulty,
    personality: Personality,
    seed = 1234,
  ) {
    this.self = self;
    this.opponent = opponent;
    this.ball = ball;
    this.arena = arena;
    this.difficulty = difficulty;
    this.personality = personality;
    this.rng = new Rng(seed);
  }

  /** Own goal z (the one this AI defends) and the attacking goal z. */
  private get ownGoalZ(): number {
    return this.self.team === 0 ? -this.arena.def.halfLength : this.arena.def.halfLength;
  }

  private get targetGoalZ(): number {
    return this.self.team === 0 ? this.arena.def.halfLength : -this.arena.def.halfLength;
  }

  private get attackDir(): number {
    return this.self.team === 0 ? 1 : -1;
  }

  reset(): void {
    this.perception.reset();
    this.state = 'kickoff';
    this.plan = null;
    this.chargingPlan = false;
    this.hesitation = 0;
    this.out = blankState();
  }

  /** Full-match reset (rematch). */
  resetMatch(): void {
    this.reset();
    this.adaptation.reset();
  }

  update(dt: number): ControlState {
    this.perception.record(this.ball.body, dt);
    this.adaptation.decay(dt);
    if (this.opponent.isHuman) {
      this.adaptation.observePosition(this.opponent.position.x, this.arena.def.halfWidth, dt);
    }

    const out = this.out;
    out.moveX = 0;
    out.moveZ = 0;
    out.sprint = false;
    out.jumpPressed = false;
    out.kickPressed = false;
    out.kickReleased = false;
    out.tacklePressed = false;
    out.slidePressed = false;
    out.challengePressed = false;
    out.lobHeld = false;
    out.aimYaw = 0;
    out.aimPitch = 0;

    if (this.frozen) {
      out.kickHeld = false;
      return out;
    }

    // Perception: what the AI believes about the ball right now.
    this.perception.sample(this.difficulty.reaction, this.sample);
    this.perceivedBall.set(this.sample.x, this.sample.y, this.sample.z);
    this.perceivedVel.set(this.sample.vx, this.sample.vy, this.sample.vz);
    predictTrajectory(this.sample, this.arena.def, this.difficulty.horizon, this.traj, this.ball.body.radius);

    this.stateTime += dt;
    this.decisionTimer -= dt;
    if (this.actionCooldown > 0) this.actionCooldown -= dt;
    this.updateStuck(dt);
    if (this.chargingPlan) this.planAge += dt;
    else this.planAge = 0;
    if (this.hesitation > 0) {
      this.hesitation -= dt;
      // Hesitating: drift, do nothing decisive.
      this.steerTo(this.self.position.x, this.self.position.z, false);
      out.kickHeld = false;
      return out;
    }
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.difficulty.tickRate;
      this.decide();
    }

    this.act(dt);
    return out;
  }

  // ------------------------------------------------------------------ brain

  private timeToReach(from: Vec3, x: number, z: number, speed: number): number {
    const d = Math.hypot(x - from.x, z - from.z);
    return d / Math.max(2, speed) + 0.18;
  }

  private decide(): void {
    const self = this.self;
    const opp = this.opponent;
    const p = this.personality;
    const d = this.difficulty;
    const arena = this.arena.def;
    const ballPos = this.perceivedBall;

    if (self.isBusy) {
      this.setState('recover');
      return;
    }

    const selfSpeed = BASE.sprintSpeed * self.archetype.maxSpeed;
    const oppSpeed = BASE.sprintSpeed * opp.archetype.maxSpeed;

    const intercept = findInterception(this.traj, self.position, selfSpeed, 1.0, 0.2);
    const oppIntercept = findInterception(this.traj, opp.position, oppSpeed, 1.0, 0.2);
    const myTime = intercept ? intercept.time : this.timeToReach(self.position, ballPos.x, ballPos.z, selfSpeed);
    const oppTime = oppIntercept
      ? oppIntercept.time
      : this.timeToReach(opp.position, ballPos.x, ballPos.z, oppSpeed);

    const ballDist = self.position.horizontalDistanceTo(ballPos);
    const oppBallDist = opp.position.horizontalDistanceTo(ballPos);
    // An opponent who is not actually moving towards the ball is not a threat to
    // win it, however close they happen to be standing.
    const oppClosing =
      oppBallDist > 0.01
        ? (opp.velocity.x * (ballPos.x - opp.position.x) +
            opp.velocity.z * (ballPos.z - opp.position.z)) /
          oppBallDist
        : 0;
    const oppIdle = oppClosing < 0.6 && oppBallDist > 2;
    const ballSpeed = Math.hypot(this.perceivedVel.x, this.perceivedVel.z);
    const looseBall = ballSpeed < 2.2 && oppBallDist > 2.4;
    const dangerZone = Math.abs(ballPos.z - this.ownGoalZ) < arena.halfLength * 0.55;
    const ballInMyThird = (ballPos.z - this.ownGoalZ) * this.attackDir < arena.halfLength * 0.7;
    const ballHigh = ballPos.y > 1.25;

    // Utility scores.
    const scores: Record<string, number> = {};
    const advantage = clamp(((oppIdle ? oppTime + 2.2 : oppTime) - myTime) * 1.2, -2.5, 2.5);

    // Chasing is only valuable while the ball is away from you; once you are on
    // it, chasing forever would just be aimless dribbling.
    scores.chase =
      Math.max(0.2, 1.1 + advantage + (looseBall ? 1.5 : 0)) *
      lerp(1, p.intercept, 0.6) *
      (1 + d.anticipation * 0.3) *
      clamp(ballDist / 3, 0.3, 1.35);
    scores.attack =
      ballDist < 3.2 && advantage > -0.25 ? (2.3 + advantage * 0.35) * p.attack : 0.2 * p.attack;
    scores.defend =
      (dangerZone ? 1.9 : 0.6) * p.defend * (advantage < 0 ? 1.5 : 0.7) +
      (oppBallDist < 2.2 && ballInMyThird ? 1.2 : 0);
    scores.pressure =
      oppBallDist < 3.4 && advantage < 0.35
        ? (1.3 + this.adaptation.pressBias * 1.1) * p.press
        : 0.15;
    const panic = Math.abs(ballPos.z - this.ownGoalZ) < arena.halfLength * 0.32;
    scores.clear = dangerZone && ballDist < 2.8 ? (2.6 + (panic ? 3.2 : 0)) * p.defend : 0;
    scores.aerial = ballHigh && ballDist < 6.5 ? 1.5 + p.intercept * 0.5 : 0;
    scores.reposition = 0.55 + (advantage < -0.9 ? 0.8 : 0);

    // Wildcards shuffle the weights a little.
    if (p.chaos > 0) {
      for (const k of Object.keys(scores)) {
        scores[k] *= 1 + this.rng.noise(p.chaos * 0.6);
      }
    }

    this.debugScores = scores;

    // Mistakes: sometimes the AI simply reacts late or picks the wrong idea.
    if (this.rng.chance(d.mistakeChance)) {
      if (this.rng.chance(0.55)) {
        this.hesitation = d.hesitation * this.rng.range(0.5, 1.2);
        return;
      }
      // Pick a random (plausible) alternative.
      const keys = Object.keys(scores);
      const k = this.rng.pick(keys);
      scores[k] *= 2.2;
    }

    let best = 'reposition';
    let bestScore = -Infinity;
    for (const [k, v] of Object.entries(scores)) {
      if (v > bestScore) {
        bestScore = v;
        best = k;
      }
    }

    // Translate the winning utility into a concrete state.
    switch (best) {
      case 'chase':
        this.setState(ballHigh && ballDist < 6 ? 'aerial' : 'chase');
        break;
      case 'attack': {
        const goalDist = Math.hypot(ballPos.x, this.targetGoalZ - ballPos.z);
        const shootRange = 9.5 + p.longShot * 9 + (this.rng.next() - 0.5) * 2;
        this.setState(goalDist < shootRange ? 'shoot' : 'attack');
        break;
      }
      case 'defend':
        this.setState('defend');
        break;
      case 'pressure':
        this.setState('pressure');
        break;
      case 'clear':
        this.setState('clear');
        break;
      case 'aerial':
        this.setState('aerial');
        break;
      default:
        this.setState('reposition');
    }
  }

  private setState(s: AIState): void {
    if (this.state !== s) {
      this.state = s;
      this.stateTime = 0;
      if (s !== 'shoot' && s !== 'clear' && s !== 'attack') {
        this.plan = null;
        this.chargingPlan = false;
      }
    }
  }

  // ----------------------------------------------------------------- acting

  private act(dt: number): void {
    if (this.isStuck && this.self.canAct()) {
      this.actDigOut();
      this.tickPlan();
      this.maybeTackle(dt);
      return;
    }
    switch (this.state) {
      case 'kickoff':
        this.actKickoff();
        break;
      case 'recover':
        this.actRecover();
        break;
      case 'chase':
      case 'intercept':
        this.actChase();
        break;
      case 'attack':
        this.actAttack(dt, false);
        break;
      case 'shoot':
        this.actAttack(dt, true);
        break;
      case 'clear':
        this.actClear(dt);
        break;
      case 'defend':
        this.actDefend();
        break;
      case 'pressure':
        this.actPressure();
        break;
      case 'aerial':
        this.actAerial(dt);
        break;
      case 'reposition':
        this.actReposition();
        break;
    }
    this.tickPlan();
    this.maybeTackle(dt);
  }

  private actKickoff(): void {
    const home = this.homePosition();
    this.steerTo(home.x, home.z, false);
  }

  private actRecover(): void {
    // Get back towards a sane position while getting up.
    const home = this.homePosition();
    this.steerTo(home.x, home.z, false);
    this.out.kickHeld = false;
  }

  private actChase(): void {
    const intercept = findInterception(
      this.traj,
      this.self.position,
      BASE.sprintSpeed * this.self.archetype.maxSpeed,
      0.9,
      0.2,
    );
    const anticipation = this.difficulty.anticipation;
    let tx: number;
    let tz: number;
    if (intercept && this.rng.next() < 0.5 + anticipation * 0.5) {
      tx = lerp(this.perceivedBall.x, intercept.point.x, anticipation);
      tz = lerp(this.perceivedBall.z, intercept.point.z, anticipation);
    } else {
      tx = this.perceivedBall.x;
      tz = this.perceivedBall.z;
    }
    // Approach from behind so the first touch goes forward.
    const goalDirX = -tx * 0.04;
    const goalDirZ = this.attackDir;
    const len = Math.hypot(goalDirX, goalDirZ) || 1;
    const standoff = clamp(this.self.position.horizontalDistanceTo(this.perceivedBall) * 0.18, 0, 0.75);
    tx -= (goalDirX / len) * standoff;
    tz -= (goalDirZ / len) * standoff;
    const dist = Math.hypot(tx - this.self.position.x, tz - this.self.position.z);
    this.steerTo(tx, tz, dist > 3.2 && this.rng.next() < this.personality.hustle + 0.35);

    // Quick touch when we arrive to keep the ball moving.
    if (dist < 1.3 && this.self.kickCooldown <= 0) {
      this.planKick(this.directionToGoalTarget(), 0.12, false, 0);
    }
  }

  private actAttack(dt: number, shooting: boolean): void {
    const self = this.self;
    const ballPos = this.perceivedBall;
    const goalZ = this.targetGoalZ;
    const aim = shooting ? this.chooseShotTarget() : this.tmp.set(0, 0, goalZ);
    const dirX = aim.x - ballPos.x;
    const dirZ = aim.z - ballPos.z;
    const dl = Math.hypot(dirX, dirZ) || 1;
    const kickDir = new Vec3(dirX / dl, 0, dirZ / dl);

    // Stand behind the ball relative to the intended kick direction.
    const setup = this.reachable(ballPos.x - kickDir.x * 0.85, ballPos.z - kickDir.z * 0.85);
    const setupX = setup.x;
    const setupZ = setup.z;
    const toSetup = Math.hypot(setupX - self.position.x, setupZ - self.position.z);
    const ballDist = self.position.horizontalDistanceTo(ballPos);

    const aligned =
      ballDist < 1.7 &&
      (ballPos.x - self.position.x) * kickDir.x + (ballPos.z - self.position.z) * kickDir.z > 0.25;

    if (!aligned) {
      this.steerTo(
        setupX,
        setupZ,
        toSetup > 2.6 && this.rng.next() < this.personality.hustle + 0.3,
        true,
      );
      if (this.chargingPlan && !shooting) this.releasePlan();
      return;
    }

    // Drive at the ball along the shot line.
    this.steerTo(
      ballPos.x + kickDir.x * 1.4,
      ballPos.z + kickDir.z * 1.4,
      !shooting && this.rng.next() < this.personality.hustle,
    );

    if (shooting) {
      if (!this.chargingPlan && self.kickCooldown <= 0) {
        const goalDist = Math.hypot(aim.x - ballPos.x, aim.z - ballPos.z);
        let charge = clamp01(goalDist / 24 + 0.34);
        charge = clamp01(charge + this.rng.noise(this.difficulty.chargeError));
        const blocked = this.shotBlocked(kickDir);
        const lob = blocked && this.rng.chance(0.35 + this.personality.lob * 0.5);
        const curve = this.chooseCurve(kickDir, blocked);
        this.planKick(kickDir, charge, lob, curve);
      }
    } else {
      // Dribble: little touches to push the ball forward.
      if (ballDist < 1.25 && self.kickCooldown <= 0 && this.rng.chance(0.35)) {
        this.planKick(kickDir, this.rng.range(0.06, 0.17), false, 0);
      }
      this.adaptation.observeDribble(dt);
    }
  }

  private actClear(dt: number): void {
    void dt;
    const self = this.self;
    const ballPos = this.perceivedBall;
    // Clear up the pitch and towards a wing (safer than through the middle).
    const sideSign = ballPos.x >= 0 ? 1 : -1;
    const targetX = sideSign * this.arena.def.halfWidth * 0.75;
    const targetZ = this.ownGoalZ + this.attackDir * this.arena.def.halfLength * 1.4;
    const dirX = targetX - ballPos.x;
    const dirZ = targetZ - ballPos.z;
    const dl = Math.hypot(dirX, dirZ) || 1;
    const kickDir = new Vec3(dirX / dl, 0, dirZ / dl);
    const setupClear = this.reachable(ballPos.x - kickDir.x * 0.8, ballPos.z - kickDir.z * 0.8);
    const setupX = setupClear.x;
    const setupZ = setupClear.z;
    const ballDist = self.position.horizontalDistanceTo(ballPos);
    const aligned =
      ballDist < 1.7 &&
      (ballPos.x - self.position.x) * kickDir.x + (ballPos.z - self.position.z) * kickDir.z > 0.2;
    if (!aligned) {
      this.steerTo(setupX, setupZ, true, true);
      return;
    }
    this.steerTo(ballPos.x + kickDir.x * 1.2, ballPos.z + kickDir.z * 1.2, true);
    if (!this.chargingPlan && self.kickCooldown <= 0) {
      this.planKick(kickDir, clamp01(0.72 + this.rng.noise(this.difficulty.chargeError)), true, 0);
    }
  }

  private actDefend(): void {
    const arena = this.arena.def;
    const ballPos = this.perceivedBall;
    const goalZ = this.ownGoalZ;
    // Sit on the line between the ball and the centre of our goal.
    const dx = ballPos.x - 0;
    const dz = ballPos.z - goalZ;
    const dl = Math.hypot(dx, dz) || 1;
    const depth = lerp(2.4, 7.5, this.personality.line) * lerp(1, 0.7, this.adaptation.pressBias);
    let tx = (dx / dl) * depth;
    let tz = goalZ + (dz / dl) * depth;
    // Shade towards the side the human likes to attack from.
    tx += this.adaptation.preferredSide * 0.9;
    // Respect wall rebounds: stay a touch more central.
    tx *= lerp(1, 0.78, this.adaptation.wallAwareness);
    tx = clamp(tx, -arena.goalWidth * 0.75, arena.goalWidth * 0.75);
    tz = clamp(tz, Math.min(goalZ + 0.6, goalZ - 0.6), Math.max(goalZ + 0.6 * this.attackDir * 12, goalZ));
    const target = this.clampToPitch(tx, goalZ + (tz - goalZ));
    const dist = Math.hypot(target.x - this.self.position.x, target.z - this.self.position.z);
    this.steerTo(target.x, target.z, dist > 4);

    // If the ball is coming at us and is reachable, step out and take it.
    const ballDist = this.self.position.horizontalDistanceTo(ballPos);
    if (ballDist < 2.2 && this.self.kickCooldown <= 0) {
      const away = new Vec3(
        this.self.position.x > 0 ? 0.55 : -0.55,
        0,
        this.attackDir,
      ).normalize();
      this.planKick(away, clamp01(0.55 + this.rng.noise(this.difficulty.chargeError)), true, 0);
    }
  }

  private actPressure(): void {
    const opp = this.opponent;
    const ballPos = this.perceivedBall;
    // Get goal-side of the opponent and close the shooting angle.
    const goalZ = this.ownGoalZ;
    const dx = opp.position.x - 0;
    const dz = opp.position.z - goalZ;
    const dl = Math.hypot(dx, dz) || 1;
    const standoff = lerp(1.25, 2.4, this.adaptation.slideAvoidance);
    const tx = opp.position.x - (dx / dl) * standoff;
    const tz = opp.position.z - (dz / dl) * standoff;
    const dist = Math.hypot(tx - this.self.position.x, tz - this.self.position.z);
    this.steerTo(tx, tz, dist > 2.4);

    // Poke at the ball if it drifts into range.
    const ballDist = this.self.position.horizontalDistanceTo(ballPos);
    if (ballDist < 1.5 && this.self.kickCooldown <= 0 && this.rng.chance(0.45)) {
      const away = new Vec3(ballPos.x - opp.position.x, 0, this.attackDir * 1.5).normalize();
      this.planKick(away, 0.25, false, 0);
    }
  }

  private actAerial(dt: number): void {
    void dt;
    const self = this.self;
    // Find where the ball will be at a headable/volleyable height.
    let best: TrajectoryPoint | null = null;
    for (const pt of this.traj) {
      if (pt.y < 0.8 || pt.y > 2.9) continue;
      const dist = Math.hypot(pt.x - self.position.x, pt.z - self.position.z);
      const reachTime = dist / (BASE.sprintSpeed * self.archetype.maxSpeed) + 0.15;
      if (reachTime <= pt.t) {
        best = pt;
        break;
      }
    }
    if (!best) {
      this.actChase();
      return;
    }
    this.steerTo(best.x, best.z, Math.hypot(best.x - self.position.x, best.z - self.position.z) > 2.5);

    const dist = Math.hypot(best.x - self.position.x, best.z - self.position.z);
    const timeToContact = best.t;
    // Jump so we meet the ball near the apex of our jump (~0.3s).
    if (
      !this.jumpArmed &&
      self.grounded &&
      dist < 1.8 &&
      best.y > 1.5 &&
      timeToContact < 0.36 &&
      timeToContact > 0.08
    ) {
      this.out.jumpPressed = true;
      this.jumpArmed = true;
    }
    if (self.grounded) this.jumpArmed = false;

    // Volley it towards goal when the ball is genuinely close.
    const realDist = self.position.distanceTo(this.perceivedBall);
    if (realDist < 2.0 && self.kickCooldown <= 0 && !this.chargingPlan) {
      const dir = this.directionToGoalTarget();
      this.planKick(dir, clamp01(0.45 + this.rng.noise(this.difficulty.chargeError)), false, 0);
    }
  }

  private actReposition(): void {
    const home = this.homePosition();
    const dist = Math.hypot(home.x - this.self.position.x, home.z - this.self.position.z);
    this.steerTo(home.x, home.z, dist > 5 && this.rng.next() < this.personality.hustle);
  }

  // --------------------------------------------------------------- helpers

  private homePosition(): Vec3 {
    const arena = this.arena.def;
    const ballPos = this.perceivedBall;
    const line = this.personality.line;
    // Between our goal and the ball, biased by personality.
    const z = lerp(this.ownGoalZ + this.attackDir * 3.2, ballPos.z - this.attackDir * 2.2, line);
    const x = clamp(ballPos.x * 0.55 + this.adaptation.preferredSide * 0.7, -arena.halfWidth * 0.8, arena.halfWidth * 0.8);
    return this.clampToPitch(x, clamp(z, -arena.halfLength + 1, arena.halfLength - 1));
  }

  private clampToPitch(x: number, z: number): Vec3 {
    const arena = this.arena.def;
    return this.target.set(
      clamp(x, -arena.halfWidth + 0.7, arena.halfWidth - 0.7),
      0,
      clamp(z, -arena.halfLength + 0.5, arena.halfLength - 0.5),
    );
  }

  /**
   * Tracks a ball pinned against a wall/corner. When it triggers, the AI stops
   * trying to line up a pretty shot and just digs the ball out.
   */
  private updateStuck(dt: number): void {
    const ball = this.perceivedBall;
    // "The ball has not actually gone anywhere while I have been stood on it."
    if (ball.horizontalDistanceTo(this.stuckAnchor) > 1.7) {
      this.stuckAnchor.set(ball.x, 0, ball.z);
      this.stuckTimer = 0;
      return;
    }
    if (this.self.position.horizontalDistanceTo(ball) < 3) this.stuckTimer += dt;
    else this.stuckTimer = Math.max(0, this.stuckTimer - dt * 1.5);
  }

  private get isStuck(): boolean {
    return this.stuckTimer > 1.1;
  }

  /** Digs the ball out of a corner towards open space. */
  private actDigOut(): void {
    // Handled below: approach, then turn away from the wall and thump it clear.
    const ball = this.perceivedBall;
    const arena = this.arena.def;
    const openX = -Math.sign(ball.x || 1) * arena.halfWidth * 0.35;
    const openZ = ball.z + this.attackDir * 4;
    const dirX = openX - ball.x;
    const dirZ = clamp(openZ, -arena.halfLength + 2, arena.halfLength - 2) - ball.z;
    const dl = Math.hypot(dirX, dirZ) || 1;
    const kickDir = new Vec3(dirX / dl, 0, dirZ / dl);
    const dist = this.self.position.horizontalDistanceTo(ball);
    if (dist > 1.0) {
      this.steerTo(ball.x - kickDir.x * 0.5, ball.z - kickDir.z * 0.5, false);
    } else {
      // Close enough to hook it out: turn away from the wall and swing.
      this.steerTo(this.self.position.x + kickDir.x, this.self.position.z + kickDir.z, false);
    }
    if (this.self.kickCooldown <= 0 && !this.chargingPlan && dist < 1.6) {
      this.planKick(kickDir, clamp01(0.32 + this.rng.range(0, 0.25)), this.rng.chance(0.4), 0);
    }
  }

  /** Keeps a set-up point on the pitch so the AI never walks into a wall. */
  private reachable(x: number, z: number): { x: number; z: number } {
    const arena = this.arena.def;
    return {
      x: clamp(x, -arena.halfWidth + 0.55, arena.halfWidth - 0.55),
      z: clamp(z, -arena.halfLength - arena.goalDepth + 0.6, arena.halfLength + arena.goalDepth - 0.6),
    };
  }

  /** Picks a spot in the opponent goal, away from the keeper-ish opponent. */
  private chooseShotTarget(): Vec3 {
    const arena = this.arena.def;
    const goalZ = this.targetGoalZ;
    const half = arena.goalWidth / 2 - 0.5;
    // Which side is the opponent covering?
    const oppX = this.opponent.position.x;
    const oppNearGoal = Math.abs(this.opponent.position.z - goalZ) < 6;
    let x: number;
    if (oppNearGoal) {
      x = oppX > 0 ? -half : half;
    } else {
      x = this.rng.range(-half, half) * 0.75;
    }
    // Wall rebound attempt (technical / chaos personalities).
    if (this.personality.wallPlay > 0.8 && this.rng.chance(0.12)) {
      this.wallTargetSign = this.rng.chance(0.5) ? 1 : -1;
      return this.tmp.set(this.wallTargetSign * arena.halfWidth, 0, goalZ * 0.45);
    }
    // Aim error grows with difficulty setting.
    x += this.rng.noise(this.difficulty.aimError * arena.goalWidth);
    return this.tmp.set(clamp(x, -half, half), 0, goalZ);
  }

  private directionToGoalTarget(): Vec3 {
    const aim = this.chooseShotTarget();
    const dx = aim.x - this.perceivedBall.x;
    const dz = aim.z - this.perceivedBall.z;
    const dl = Math.hypot(dx, dz) || 1;
    return new Vec3(dx / dl, 0, dz / dl);
  }

  /** Is the opponent standing in the shooting lane? */
  private shotBlocked(dir: Vec3): boolean {
    const ballPos = this.perceivedBall;
    const ox = this.opponent.position.x - ballPos.x;
    const oz = this.opponent.position.z - ballPos.z;
    const along = ox * dir.x + oz * dir.z;
    if (along < 0.4 || along > 7) return false;
    const perp = Math.abs(ox * dir.z - oz * dir.x);
    return perp < 1.2;
  }

  private chooseCurve(dir: Vec3, blocked: boolean): number {
    if (!blocked) return this.rng.noise(0.15);
    const ox = this.opponent.position.x - this.perceivedBall.x;
    const oz = this.opponent.position.z - this.perceivedBall.z;
    const side = ox * dir.z - oz * dir.x;
    const skill = this.difficulty.anticipation * (this.personality.wallPlay + 0.6);
    return clamp(side > 0 ? -skill : skill, -1, 1);
  }

  private planKick(dir: Vec3, charge: number, lob: boolean, curve: number): void {
    const safe = this.avoidOwnGoal(dir.clone().normalize());
    this.plan = { dir: safe, charge: clamp01(charge), lob, curve };
    this.chargingPlan = true;
    this.out.kickPressed = true;
    this.out.kickHeld = true;
  }

  /**
   * Nobody deliberately blasts it into their own net. If the intended direction
   * points home from a dangerous position, turn it towards the nearest touchline.
   */
  private avoidOwnGoal(dir: Vec3): Vec3 {
    const ball = this.perceivedBall;
    const homeward = -this.attackDir;
    const distToOwn = Math.abs(ball.z - this.ownGoalZ);
    if (distToOwn > 13) return dir;
    const towardsOwn = dir.z * homeward;
    if (towardsOwn < 0.42) return dir;
    // Slice it wide instead.
    const side = Math.sign(ball.x || (this.rng.chance(0.5) ? 1 : -1));
    const out = new Vec3(side * 0.94, 0, this.attackDir * 0.34);
    return out.normalize();
  }

  private releasePlan(): void {
    this.out.kickHeld = false;
    this.out.kickReleased = true;
    this.chargingPlan = false;
    this.plan = null;
  }

  private tickPlan(): void {
    const plan = this.plan;
    if (!plan || !this.chargingPlan) return;
    this.out.kickHeld = true;
    this.out.lobHeld = plan.lob;

    // Turning into the shot uses exactly the channel a human has: the stick.
    // Facing follows movement, so the AI must physically turn to aim.
    const ballDist = this.self.position.horizontalDistanceTo(this.perceivedBall);
    if (ballDist < 1.25) {
      this.out.moveX = clamp(plan.dir.x + plan.curve * 0.6, -1, 1);
      this.out.moveZ = clamp(plan.dir.z, -1, 1);
      this.out.sprint = false;
    } else if (Math.abs(plan.curve) > 0.05) {
      // Bend the shot: lateral input during the charge feeds the curve system.
      this.out.moveX = clamp(plan.curve, -1, 1);
    }

    const aimYaw = yawFromDirection(plan.dir.x, plan.dir.z);
    const aligned = Math.abs(angleDelta(this.self.yaw, aimYaw)) < 0.45;
    const charged = this.self.charge >= plan.charge - 0.02;
    if (
      (charged && (aligned || ballDist > 1.25)) ||
      this.self.swingTimer > 0 ||
      this.planAge > 1.4 ||
      !this.self.canAct()
    ) {
      this.releasePlan();
    }
  }

  /** Tackling / sliding decisions with genuine foul risk awareness. */
  private maybeTackle(dt: number): void {
    void dt;
    const self = this.self;
    const opp = this.opponent;
    if (!self.canAct()) return;
    if (this.actionCooldown > 0) return;
    // Physical challenges are re-considered a few times per second.
    this.actionCooldown = 0.3;

    const ballPos = this.perceivedBall;
    const ballDist = self.position.horizontalDistanceTo(ballPos);
    const oppDist = self.position.horizontalDistanceTo(opp.position);
    const oppBallDist = opp.position.horizontalDistanceTo(ballPos);
    const oppHasBall = oppBallDist < 1.8;
    const skill = this.difficulty.tackleSkill;
    const facingBall = this.isFacing(ballPos, 0.35);

    // Standing tackle: safe, short range, only worth it when someone else has it.
    if (
      oppHasBall &&
      ballDist < 2.0 &&
      facingBall &&
      self.tackleCooldown <= 0 &&
      this.rng.chance(0.3 + skill * 0.5)
    ) {
      this.out.tacklePressed = true;
      this.actionCooldown = 0.6;
      return;
    }

    // Slide: a real commitment. Only when the ball is genuinely winnable and we
    // are not about to scythe down the opponent (that would be a foul).
    const ballAhead = ballDist > 1.2 && ballDist < 3.2 && ballPos.y < 1.1;
    const wouldFoul = oppHasBall && oppDist < ballDist - 0.35;
    const worthIt = oppHasBall || (ballDist < 2.6 && oppBallDist < ballDist + 0.8);
    if (
      self.grounded &&
      facingBall &&
      ballAhead &&
      worthIt &&
      self.slideRecovery <= 0 &&
      (!wouldFoul || this.rng.chance((1 - skill) * 0.3)) &&
      this.rng.chance(this.personality.slide * (0.12 + skill * 0.25))
    ) {
      this.out.slidePressed = true;
      this.actionCooldown = 2.2;
      return;
    }

    // Shoulder to shoulder barge.
    if (
      oppDist < 1.5 &&
      ballDist < 2.6 &&
      self.challengeCooldown <= 0 &&
      this.isFacing(opp.position, 0.65) &&
      this.rng.chance(0.25 + this.personality.press * 0.3)
    ) {
      this.out.challengePressed = true;
      this.actionCooldown = 0.9;
    }
  }

  private isFacing(point: Vec3, threshold: number): boolean {
    const f = this.self.facing(this.tmp);
    const dx = point.x - this.self.position.x;
    const dz = point.z - this.self.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx / d) * f.x + (dz / d) * f.z > threshold;
  }

  /** Emit movement input towards a world position (AI uses world-space axes). */
  /**
   * Walking to a spot *behind* the ball must not mean barging straight through
   * it - that is how you shin it into your own net. Curve around instead.
   */
  private arcAroundBall(x: number, z: number): { x: number; z: number } {
    const self = this.self;
    const ball = this.perceivedBall;
    const tx = x - self.position.x;
    const tz = z - self.position.z;
    const bx = ball.x - self.position.x;
    const bz = ball.z - self.position.z;
    const tLen = Math.hypot(tx, tz);
    const bLen = Math.hypot(bx, bz);
    if (tLen < 0.05 || bLen > 3.2 || bLen < 0.05) return { x, z };
    const along = (bx * tx + bz * tz) / tLen;
    if (along < 0 || along > tLen + 0.6) return { x, z };
    const perp = Math.abs(bx * (tz / tLen) - bz * (tx / tLen));
    const clearance = self.capsule.radius + 0.55;
    if (perp > clearance) return { x, z };
    // Sidestep on whichever side we are already leaning towards.
    const side = bx * (tz / tLen) - bz * (tx / tLen) >= 0 ? -1 : 1;
    const offset = (clearance - perp) + 0.5;
    return {
      x: x + (tz / tLen) * side * offset,
      z: z - (tx / tLen) * side * offset,
    };
  }

  private steerTo(x: number, z: number, sprint: boolean, avoidBall = false): void {
    if (avoidBall) {
      const around = this.arcAroundBall(x, z);
      x = around.x;
      z = around.z;
    }
    const dx = x - this.self.position.x;
    const dz = z - this.self.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) {
      this.out.moveX = 0;
      this.out.moveZ = 0;
      return;
    }
    // Slow down on approach so the AI does not overshoot the ball.
    const gain = clamp(d / 0.9, 0.25, 1);
    // Avoid obstacles: gently steer around the opponent when not challenging.
    let nx = (dx / d) * gain;
    let nz = (dz / d) * gain;
    const ox = this.self.position.x - this.opponent.position.x;
    const oz = this.self.position.z - this.opponent.position.z;
    const od = Math.hypot(ox, oz);
    if (od < 1.3 && this.state !== 'pressure') {
      nx += (ox / (od || 1)) * 0.5;
      nz += (oz / (od || 1)) * 0.5;
    }
    const len = Math.hypot(nx, nz) || 1;
    // Curve input during a charge must not be overwritten by steering.
    if (!this.chargingPlan || Math.abs(this.out.moveX) < 0.05) {
      this.out.moveX = nx / len;
      this.out.moveZ = nz / len;
    } else {
      this.out.moveZ = nz / len;
    }
    this.out.sprint = sprint && this.self.stamina > 12;
  }

  /** Called by the game when the human does something noteworthy. */
  notePlayerShot(distance: number, lob: boolean, airborne: boolean): void {
    this.adaptation.observeShot(distance, lob, airborne);
  }

  notePlayerSlide(): void {
    this.adaptation.observeSlide();
  }

  noteWallRebound(): void {
    this.adaptation.observeWallRebound();
  }

  noteTouch(byMe: boolean): void {
    this.lastTouchWasMine = byMe;
  }

  get lastTouchMine(): boolean {
    return this.lastTouchWasMine;
  }
}
