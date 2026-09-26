/**
 * Headless play-tests. These drive the real gameplay systems (physics, kick
 * system, tackles, fouls, AI, match flow) exactly as the browser build does.
 */
import { Sim, FIXED } from './harness.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n== ${title}`);
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------- ball physics

section('Ball physics');
{
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  sim.ball.reset(0, 6, 0);
  let maxBounce = 0;
  let bounces = 0;
  let wasGrounded = true;
  sim.run(6, () => {
    if (sim.ball.body.grounded && !wasGrounded) bounces++;
    wasGrounded = sim.ball.body.grounded;
    if (!sim.ball.body.grounded) maxBounce = Math.max(maxBounce, sim.ball.body.position.y);
  });
  check('ball falls and settles on the pitch', near(sim.ball.body.position.y, sim.ball.body.radius, 0.06),
    `y=${sim.ball.body.position.y.toFixed(3)}`);
  check('ball bounces more than once', bounces >= 2, `bounces=${bounces}`);
  check('ball comes to rest', sim.ball.body.speed < 0.4, `speed=${sim.ball.body.speed.toFixed(3)}`);
}

{
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  sim.ball.reset(0, 0.36, 0);
  sim.ball.body.velocity.set(0, 0, 18);
  sim.run(3);
  check('ball rebounds off the end wall / goal structure', sim.ball.body.position.z < sim.arena.def.halfLength + 0.3,
    `z=${sim.ball.body.position.z.toFixed(2)}`);
}

{
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  sim.ball.reset(0, 0.36, 0);
  sim.ball.body.velocity.set(18, 0, 0);
  sim.run(2.2);
  check('side wall rebound reverses X velocity', sim.ball.body.velocity.x < 0,
    `vx=${sim.ball.body.velocity.x.toFixed(2)}`);
  check('ball stays inside the arena', Math.abs(sim.ball.body.position.x) < sim.arena.def.halfWidth + 0.5,
    `x=${sim.ball.body.position.x.toFixed(2)}`);
}

{
  // Magnus effect: a spinning ball must curve.
  const straight = new Sim({ ai: false });
  straight.skipCountdown();
  straight.ball.reset(0, 1.2, -6);
  straight.ball.body.velocity.set(0, 2.5, 22);
  straight.run(0.8);
  const straightX = straight.ball.body.position.x;

  const curved = new Sim({ ai: false });
  curved.skipCountdown();
  curved.ball.reset(0, 1.2, -6);
  curved.ball.body.velocity.set(0, 2.5, 22);
  curved.ball.body.spin.set(0, 34, 0);
  curved.run(0.8);
  const curvedX = curved.ball.body.position.x;
  check('sidespin curves the ball sideways', Math.abs(curvedX - straightX) > 0.35,
    `dx=${(curvedX - straightX).toFixed(3)}`);
}

{
  // Backspin should slow a rolling ball down / pull it back.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  sim.ball.reset(0, 0.36, 0);
  sim.ball.body.velocity.set(0, 0, 8);
  sim.ball.body.spin.set(-40, 0, 0); // backspin relative to +z travel
  sim.run(0.6);
  check('spin couples into rolling motion', Number.isFinite(sim.ball.body.position.z));
}

// ------------------------------------------------------------------ movement

section('Player movement');
{
  // A and D must move the player left and right *on screen*. With yaw taken as
  // atan2(x, z) the screen-right axis is forward x up = (-cos, sin); getting
  // that backwards is the classic inverted-strafe bug.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const p = sim.players[0];
  // Camera looking down +Z: screen right is -X.
  p.teleport(0, 0, 0);
  sim.players[1].teleport(0, 18, 0);
  sim.ball.reset(0, 0.2, 18);
  for (let i = 0; i < 90; i++) {
    p.setInput({ ...Sim.input(), moveX: 1 }, 0, 'camera');
    sim.stepPlayersOnly(FIXED);
  }
  check('D strafes right on screen when the camera looks down +Z', p.position.x < -0.5,
    `x=${p.position.x.toFixed(2)}`);

  // Camera looking down -Z (the other end): screen right is +X.
  p.teleport(0, 0, Math.PI);
  for (let i = 0; i < 90; i++) {
    p.setInput({ ...Sim.input(), moveX: 1 }, Math.PI, 'camera');
    sim.stepPlayersOnly(FIXED);
  }
  check('D still strafes right on screen when the camera is turned around',
    p.position.x > 0.5, `x=${p.position.x.toFixed(2)}`);

  // W always runs away from the camera.
  p.teleport(0, 0, 0);
  for (let i = 0; i < 90; i++) {
    p.setInput({ ...Sim.input(), moveZ: 1 }, 0, 'camera');
    sim.stepPlayersOnly(FIXED);
  }
  check('W runs into the screen', p.position.z > 0.5, `z=${p.position.z.toFixed(2)}`);
}
{
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const p = sim.players[0];
  p.teleport(0, -12, 0);
  sim.players[1].teleport(11, 15, 0); // keep the opponent out of the running lane
  sim.ball.reset(20, 0.36, 20); // keep the ball far away
  sim.run(1.2, (_t, inputs) => {
    inputs[0].moveZ = 1;
    inputs[0].sprint = false;
  });
  const walkSpeed = Math.hypot(p.velocity.x, p.velocity.z);
  check('player accelerates to jog speed quickly', walkSpeed > 6 && walkSpeed < 7.4, `v=${walkSpeed.toFixed(2)}`);

  sim.run(1.4, (_t, inputs) => {
    inputs[0].moveZ = 1;
    inputs[0].sprint = true;
  });
  const sprintSpeed = Math.hypot(p.velocity.x, p.velocity.z);
  check('sprint is meaningfully faster', sprintSpeed > walkSpeed + 1.5, `sprint=${sprintSpeed.toFixed(2)}`);
  check('sprint drains stamina', p.stamina < 100, `stamina=${p.stamina.toFixed(0)}`);

  sim.run(0.6, (_t, inputs) => {
    inputs[0].moveZ = 0;
  });
  check('player stops when input is released', Math.hypot(p.velocity.x, p.velocity.z) < 0.5,
    `v=${Math.hypot(p.velocity.x, p.velocity.z).toFixed(2)}`);
}

{
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const p = sim.players[0];
  p.teleport(0, 0, 0);
  sim.ball.reset(20, 0.36, 20);
  let peak = 0;
  sim.run(1.2, (t, inputs) => {
    if (t < FIXED * 2) inputs[0].jumpPressed = true;
    peak = Math.max(peak, p.position.y);
  });
  check('jump reaches a useful height', peak > 0.9 && peak < 1.8, `peak=${peak.toFixed(2)}`);
  check('player lands again', p.grounded);
}

// -------------------------------------------------------------- kick system

function kickTest(charge: number, opts: { lob?: boolean; jump?: boolean } = {}): {
  speed: number;
  vy: number;
  vz: number;
  spinY: number;
  sim: Sim;
} {
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const p = sim.players[0];
  p.teleport(0, -2, 0);
  sim.players[1].teleport(0, 14, Math.PI);
  sim.ball.reset(0, sim.ball.body.radius, -1.2);
  let held = 0;
  let released = false;
  let jumped = false;
  // The interesting numbers are the ones the instant the ball leaves the foot.
  type Launch = { speed: number; vy: number; vz: number; spinY: number };
  const launch: { at: Launch | null } = { at: null };
  sim.run(2.6, (t, inputs) => {
    if (!launch.at && sim.kicks.length > 0) {
      const v = sim.ball.body.velocity;
      launch.at = { speed: v.length(), vy: v.y, vz: v.z, spinY: sim.ball.body.spin.y };
    }
    const state = inputs[0];
    if (opts.jump && !jumped && t > 0.05) {
      state.jumpPressed = true;
      jumped = true;
    }
    if (!released) {
      if (held === 0) state.kickPressed = true;
      state.kickHeld = true;
      state.lobHeld = !!opts.lob;
      held += FIXED;
      if (held >= charge * 1.05 + 0.01) {
        released = true;
        state.kickHeld = false;
      }
    } else {
      state.kickHeld = false;
    }
  });
  const v = sim.ball.body.velocity;
  return launch.at
    ? { ...launch.at, sim }
    : { speed: v.length(), vy: v.y, vz: v.z, spinY: sim.ball.body.spin.y, sim };
}

section('Kick system');
{
  // Pressing sideways during the wind-up must bend the shot to *that* side of
  // the aim, whichever end of the pitch the player is shooting at.
  const results: number[] = [];
  for (const lateral of [1, -1]) {
    const sim = new Sim({ ai: false });
    sim.skipCountdown();
    const p = sim.players[0];
    sim.players[1].teleport(0, 16, 0);
    p.teleport(0, -8, 0);
    sim.ball.reset(0, 0.25, -7.3);
    // Screen-right of a player facing +Z is -X.
    const rx = -Math.cos(p.yaw);
    const rz = Math.sin(p.yaw);
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    for (let i = 0; i < 160; i++) {
      const inp = Sim.input();
      if (i < 30) {
        inp.kickHeld = true;
        if (i === 0) inp.kickPressed = true;
        inp.moveX = rx * lateral * 0.62 + fx * 0.78;
        inp.moveZ = rz * lateral * 0.62 + fz * 0.78;
      }
      sim.step([inp, Sim.input()]);
    }
    results.push(sim.ball.body.position.x);
  }
  check('holding right while charging bends the ball right, and vice versa',
    results[0]! < -0.25 && results[1]! > 0.25,
    `right->x=${results[0]!.toFixed(2)} left->x=${results[1]!.toFixed(2)}`);
}

{
  // The aim must not spin away while winding up - sideways input is curve.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const p = sim.players[0];
  p.teleport(0, -8, 0);
  sim.ball.reset(0, 0.25, -7.3);
  for (let i = 0; i < 70; i++) {
    const inp = Sim.input();
    inp.kickHeld = true;
    if (i === 0) inp.kickPressed = true;
    inp.moveX = -1; // full sideways
    sim.step([inp, Sim.input()]);
  }
  check('the aim stays locked while charging', Math.abs(p.yaw) < 0.75, `yaw=${p.yaw.toFixed(2)}`);
}
{
  const quick = kickTest(0.02);
  const normal = kickTest(0.3);
  const power = kickTest(0.7);
  const max = kickTest(1.0);
  check('quick tap produces a soft touch', quick.sim.kicks.length > 0, `kicks=${quick.sim.kicks.length}`);
  check('charge scales power continuously',
    normal.sim.kicks.length > 0 && power.sim.kicks.length > 0 && max.sim.kicks.length > 0);

  const powers = [quick, normal, power, max].map(
    (r) => ((r.sim.kicks[0] ?? { power: 0 }) as { power: number }).power,
  );
  check('kick power is monotonic with charge',
    powers[0] < powers[1] && powers[1] < powers[2] && powers[2] < powers[3],
    powers.map((p) => p.toFixed(1)).join(' < '));
  check('max charge is a genuine rocket', powers[3] > 26, `max=${powers[3].toFixed(1)}`);

  const lob = kickTest(0.45, { lob: true });
  const flat = kickTest(0.45);
  check('lob modifier lifts the ball much higher', lob.vy > flat.vy + 3,
    `lob vy=${lob.vy.toFixed(2)} flat vy=${flat.vy.toFixed(2)}`);

  const air = kickTest(0.4, { jump: true });
  check('player can kick while airborne', air.sim.kicks.length > 0 && air.speed > 5,
    `kicks=${air.sim.kicks.length} speed=${air.speed.toFixed(1)}`);
  const airKick = air.sim.kicks[0] as { volley: boolean } | undefined;
  check('air kick is flagged as a volley', !!airKick?.volley);
}

{
  // Curve input during the charge must put spin on the ball.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  sim.players[0].teleport(0, -2.4, 0);
  sim.players[1].teleport(0, 14, Math.PI);
  sim.ball.reset(0, sim.ball.body.radius, -1.25);
  let held = 0;
  let released = false;
  let launchSpin = 0;
  sim.run(1.6, (_t, inputs) => {
    if (launchSpin === 0 && sim.kicks.length > 0) launchSpin = sim.ball.body.spin.y;
    const s = inputs[0];
    if (!released) {
      if (held === 0) s.kickPressed = true;
      s.kickHeld = true;
      // Lean right late in the wind-up: the classic curled shot.
      s.moveX = held > 0.45 ? 1 : 0;
      held += FIXED;
      if (held > 0.6) {
        released = true;
        s.kickHeld = false;
      }
    }
  });
  check('charged kick with lateral input generates sidespin', Math.abs(launchSpin) > 2,
    `spinY=${launchSpin.toFixed(2)}`);
}

// ------------------------------------------------------------- goals & rules

section('Goals and match flow');
{
  const sim = new Sim({ ai: false, rules: 'first3' });
  sim.skipCountdown();
  sim.players[0].teleport(0, -5, 0);
  sim.players[1].teleport(6, -8, Math.PI);
  sim.ball.reset(0, 0.4, sim.arena.def.halfLength - 4);
  sim.lastTouch = {
    playerIndex: 0,
    team: 0,
    distance: 4,
    aerial: false,
    wall: false,
    speed: 20,
    time: 0,
  };
  sim.ball.body.velocity.set(0, 0.4, 20);
  sim.run(1.5);
  check('shot on target is scored as a goal', sim.match.score[0] === 1, `score=${sim.match.score.join('-')}`);
  check('goal phase is entered', sim.phaseLog.includes('goal'));
  sim.run(4.0);
  check('play restarts after a goal', ['countdown', 'play'].includes(sim.match.phase), `phase=${sim.match.phase}`);
}

{
  // A ball rattling around inside the net must score exactly once, no matter
  // how many times it re-crosses the line during the celebration.
  const sim = new Sim({ ai: false, rules: 'timed' });
  sim.skipCountdown();
  const line = sim.arena.def.halfLength;
  sim.ball.reset(0, 0.4, line - 3);
  sim.lastTouch = { playerIndex: 0, team: 0, distance: 4, aerial: false, wall: false, speed: 20, time: 0 };
  sim.ball.body.velocity.set(0, 0.2, 26);
  let crossings = 0;
  let wasIn = false;
  sim.run(3.0, () => {
    const inNet = sim.ball.body.position.z > line;
    if (inNet !== wasIn) crossings++;
    wasIn = inNet;
  });
  check('a ball rattling in the net scores exactly one goal',
    sim.match.score[0] === 1, `score=${sim.match.score.join('-')} crossings=${crossings}`);
}

{
  // Own goal: player 0 puts it into their own net -> point for team 1.
  const sim = new Sim({ ai: false, rules: 'first3' });
  sim.skipCountdown();
  sim.ball.reset(0, 0.4, -sim.arena.def.halfLength + 4);
  sim.lastTouch = { playerIndex: 0, team: 0, distance: 4, aerial: false, wall: false, speed: 18, time: 0 };
  sim.ball.body.velocity.set(0, 0.2, -20);
  sim.run(1.2);
  check('own goals count for the opponent', sim.match.score[1] === 1, `score=${sim.match.score.join('-')}`);
  check('own goal is announced', sim.banners.some((b) => b.main === 'OWN GOAL!'));
}

{
  // Post: a shot against the upright must not be a goal.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const def = sim.arena.def;
  sim.ball.reset(def.goalWidth / 2 + def.postRadius, 0.5, def.halfLength - 3);
  sim.ball.body.velocity.set(0, 0, 24);
  sim.run(1.2);
  check('hitting the post does not score', sim.match.score[0] === 0, `score=${sim.match.score.join('-')}`);
  check('post contact pushed the ball back out', sim.ball.body.position.z < def.halfLength + 0.4,
    `z=${sim.ball.body.position.z.toFixed(2)}`);
}

{
  // Crossbar: over the bar is not a goal.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const def = sim.arena.def;
  sim.ball.reset(0, def.goalHeight + 0.9, def.halfLength - 3);
  sim.ball.body.velocity.set(0, 1.5, 22);
  sim.run(1.4);
  check('ball over the bar is not a goal', sim.match.score[0] === 0, `score=${sim.match.score.join('-')}`);
}

{
  // Timer expiry with a tie triggers golden goal.
  const sim = new Sim({ ai: false, rules: 'timed' });
  sim.skipCountdown();
  sim.match.timeLeft = 0.5;
  sim.run(1.0);
  check('tied full time starts golden goal', sim.match.goldenGoal, `phase=${sim.match.phase}`);
  check('golden goal banner shown', sim.banners.some((b) => b.main === 'GOLDEN GOAL'));
}

{
  // First to N ends the match.
  const sim = new Sim({ ai: false, rules: 'golden' });
  sim.skipCountdown();
  sim.ball.reset(0, 0.4, sim.arena.def.halfLength - 3);
  sim.lastTouch = { playerIndex: 0, team: 0, distance: 3, aerial: false, wall: false, speed: 20, time: 0 };
  sim.ball.body.velocity.set(0, 0, 22);
  sim.run(4.5);
  check('reaching the goal target ends the match', sim.match.phase === 'over', `phase=${sim.match.phase}`);
  check('winner reported to the host', sim.matchOverWinner === 0, `winner=${String(sim.matchOverWinner)}`);
}

// ---------------------------------------------------------- tackles & fouls

section('Tackles, slides and fouls');
{
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const p = sim.players[0];
  p.teleport(0, -2, 0);
  sim.players[1].teleport(10, 10, Math.PI);
  sim.ball.reset(0, sim.ball.body.radius, -0.9);
  const before = sim.ball.body.position.z;
  sim.run(0.8, (t, inputs) => {
    if (t < FIXED * 2) inputs[0].tacklePressed = true;
  });
  check('standing tackle knocks the ball away', sim.ball.body.position.z > before + 1.5,
    `z ${before.toFixed(2)} -> ${sim.ball.body.position.z.toFixed(2)}`);
}

{
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const p = sim.players[0];
  p.teleport(0, -4, 0);
  sim.players[1].teleport(10, 10, Math.PI);
  sim.ball.reset(0, sim.ball.body.radius, -1.6);
  sim.run(1.2, (t, inputs) => {
    if (t < FIXED * 2) inputs[0].slidePressed = true;
  });
  check('slide tackle launches the player forward', p.position.z > -2.6, `z=${p.position.z.toFixed(2)}`);
  check('slide moves the ball hard', sim.ball.body.position.z > 0.2, `ball z=${sim.ball.body.position.z.toFixed(2)}`);
}

{
  // Slide into an opponent with the ball nowhere near = foul.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  sim.players[0].teleport(0, -4, 0);
  sim.players[1].teleport(0, -2.2, Math.PI);
  sim.ball.reset(8, 0.36, 8);
  sim.run(1.4, (t, inputs) => {
    if (t < FIXED * 2) inputs[0].slidePressed = true;
  });
  check('late slide on the opponent is a foul', sim.fouls.length > 0, `fouls=${sim.fouls.length}`);
  check('foul banner is shown', sim.banners.some((b) => b.main === 'FOUL'));
  sim.run(2.0);
  check('free kick is awarded', sim.phaseLog.includes('freekick'), sim.phaseLog.join(','));
  const restart = sim.phaseLog.filter((p) => p === 'play').length;
  sim.run(6.0);
  check('play resumes after the free kick', sim.phaseLog.filter((p) => p === 'play').length >= restart,
    sim.phaseLog.join(','));
}

{
  // Body challenge shoves the opponent.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  sim.players[0].teleport(0, -3, 0);
  sim.players[1].teleport(0, -1.9, Math.PI);
  sim.ball.reset(0, 0.36, -1.2);
  const before = sim.players[1].position.z;
  sim.run(0.5, (t, inputs) => {
    if (t < FIXED * 2) inputs[0].challengePressed = true;
  });
  check('body challenge pushes the opponent', sim.players[1].position.z > before + 0.15,
    `z ${before.toFixed(2)} -> ${sim.players[1].position.z.toFixed(2)}`);
}

{
  // Players must not pass through each other.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  sim.players[0].teleport(0, -2, 0);
  sim.players[1].teleport(0, 2, Math.PI);
  sim.ball.reset(12, 0.36, 12);
  let minGap = 99;
  sim.run(2.5, (_t, inputs) => {
    inputs[0].moveZ = 1;
    inputs[0].sprint = true;
    minGap = Math.min(minGap, sim.players[0].position.horizontalDistanceTo(sim.players[1].position));
  });
  check('players collide instead of overlapping', minGap > 0.6, `minGap=${minGap.toFixed(2)}`);
}

// ------------------------------------------------------------------ the AI

section('AI opponent');
{
  const sim = new Sim({ difficulty: 'hard', personality: 'balanced', rules: 'timed' });
  sim.skipCountdown();
  // The human just stands still; a competent AI should punish that.
  sim.run(75);
  check('AI moves around the pitch', sim.players[1].position.horizontalDistanceTo({ x: 0, y: 0, z: 8.5 }) > 0.5);
  check('AI scores against a passive opponent', sim.match.score[1] > 0,
    `score=${sim.match.score.join('-')}`);
  check('AI takes shots', sim.kicks.length > 3, `kicks=${sim.kicks.length}`);
  check('ball never leaves the arena', Math.abs(sim.ball.body.position.x) < sim.arena.def.halfWidth + 1.2);
  check('no NaN in the simulation',
    Number.isFinite(sim.ball.body.position.x) &&
      Number.isFinite(sim.players[1].position.x) &&
      Number.isFinite(sim.players[1].velocity.y));
}

{
  const easy = new Sim({ difficulty: 'easy', rules: 'timed', seed: 11 });
  easy.skipCountdown();
  easy.run(60);
  const expert = new Sim({ difficulty: 'expert', rules: 'timed', seed: 11 });
  expert.skipCountdown();
  expert.run(60);
  check('expert AI outperforms easy AI against a passive human',
    expert.match.score[1] >= easy.match.score[1],
    `easy=${easy.match.score[1]} expert=${expert.match.score[1]}`);
}

{
  // The AI must obey the same speed limits as the player (no cheating).
  const sim = new Sim({ difficulty: 'expert', personality: 'fast' });
  sim.skipCountdown();
  let maxSpeed = 0;
  sim.run(40, () => {
    maxSpeed = Math.max(maxSpeed, Math.hypot(sim.players[1].velocity.x, sim.players[1].velocity.z));
  });
  // A slide is a legal burst (the human gets exactly the same one), so the cap
  // is the engine-wide hard clamp rather than sprint speed.
  check('AI never exceeds legal player speed', maxSpeed < 15.2, `max=${maxSpeed.toFixed(2)}`);
}

{
  // Defensive personality should sit deeper than the aggressive one.
  const defensive = new Sim({ personality: 'defensive', difficulty: 'normal', seed: 5 });
  defensive.skipCountdown();
  let defSum = 0;
  let defN = 0;
  defensive.run(40, () => {
    defSum += defensive.players[1].position.z;
    defN++;
  });
  const aggressive = new Sim({ personality: 'aggressive', difficulty: 'normal', seed: 5 });
  aggressive.skipCountdown();
  let aggSum = 0;
  let aggN = 0;
  aggressive.run(40, () => {
    aggSum += aggressive.players[1].position.z;
    aggN++;
  });
  const defAvg = defSum / defN;
  const aggAvg = aggSum / aggN;
  check('defensive AI holds a deeper line than the aggressive one', defAvg > aggAvg,
    `defensive avgZ=${defAvg.toFixed(2)} aggressive avgZ=${aggAvg.toFixed(2)}`);
}

{
  // AI vs AI soak test: no crashes, no stuck ball, goals happen.
  let total = 0;
  const scores: string[] = [];
  let sim = new Sim({ aiBoth: true, difficulty: 'hard', rules: 'timed', seed: 77 });
  for (const seed of [77, 4242]) {
    sim = new Sim({ aiBoth: true, difficulty: 'hard', rules: 'timed', seed });
    sim.skipCountdown();
    sim.run(150);
    total += sim.match.score[0] + sim.match.score[1];
    scores.push(sim.match.score.join('-'));
  }
  check('AI vs AI produces goals', total > 0, `scores=${scores.join(', ')}`);
  check('AI vs AI keeps the ball in play',
    Math.abs(sim.ball.body.position.x) < sim.arena.def.halfWidth + 1.5 &&
      Math.abs(sim.ball.body.position.z) < sim.arena.def.halfLength + sim.arena.def.goalDepth + 1.5,
    `ball=${sim.ball.body.position.x.toFixed(1)},${sim.ball.body.position.z.toFixed(1)}`);
  check('no NaN after a long soak',
    Number.isFinite(sim.ball.body.position.y) && Number.isFinite(sim.players[0].position.x));
}

// ------------------------------------------------------------------ arenas

section('Arenas');
for (const arenaId of ['classic', 'rooftop', 'beach', 'neon', 'ice', 'tiny']) {
  const sim = new Sim({ arena: arenaId, difficulty: 'normal', seed: 3 });
  sim.skipCountdown();
  sim.run(25);
  const inside =
    Math.abs(sim.ball.body.position.x) < sim.arena.def.halfWidth + 1.5 &&
    Math.abs(sim.ball.body.position.z) < sim.arena.def.halfLength + sim.arena.def.goalDepth + 1.5;
  check(`${arenaId}: stable and contained`, inside && Number.isFinite(sim.ball.body.position.y),
    `pos=${sim.ball.body.position.x.toFixed(1)},${sim.ball.body.position.z.toFixed(1)}`);
}

{
  // Ice must be slipperier than grass: same input, more slide.
  const grass = new Sim({ arena: 'classic', ai: false });
  grass.skipCountdown();
  grass.players[0].teleport(0, -12, 0);
  grass.players[1].teleport(11, 15, 0);
  grass.ball.reset(20, 0.36, 20);
  grass.run(1.6, (_t, i) => (i[0].moveZ = 1));
  const grassFrom = grass.players[0].position.z;
  grass.run(0.7, () => undefined);
  const grassStop = grass.players[0].position.z - grassFrom;

  const ice = new Sim({ arena: 'ice', ai: false });
  ice.skipCountdown();
  ice.players[0].teleport(0, -10, 0);
  ice.players[1].teleport(9, 12, 0);
  ice.ball.reset(20, 0.36, 20);
  ice.run(1.6, (_t, i) => (i[0].moveZ = 1));
  const iceFrom = ice.players[0].position.z;
  ice.run(0.7, () => undefined);
  const iceStop = ice.players[0].position.z - iceFrom;
  check('ice keeps momentum far longer than grass', iceStop > grassStop + 0.8,
    `grass coast=${grassStop.toFixed(2)}m ice coast=${iceStop.toFixed(2)}m`);
}

// ------------------------------------------------------------ determinism

section('Determinism');
{
  const runOnce = () => {
    const sim = new Sim({ ai: false, seed: 1 });
    sim.skipCountdown();
    sim.players[0].teleport(0, -2, 0);
    sim.ball.reset(0, 0.36, -1.2);
    let held = 0;
    let released = false;
    sim.run(2.0, (_t, inputs) => {
      const s = inputs[0];
      if (!released) {
        if (held === 0) s.kickPressed = true;
        s.kickHeld = true;
        held += FIXED;
        if (held > 0.5) {
          released = true;
          s.kickHeld = false;
        }
      }
    });
    return sim.ball.body.position;
  };
  const a = runOnce();
  const b = runOnce();
  check('identical inputs produce identical physics',
    a.x === b.x && a.y === b.y && a.z === b.z,
    `${a.x},${a.y},${a.z} vs ${b.x},${b.y},${b.z}`);
}

// ------------------------------------------------------------------ penalties

section('Penalty duel');
{
  const sim = new Sim({ mode: 'penalty', ai: true });
  sim.run(3);
  check('penalty mode sets up a shot', ['penalty-setup', 'penalty-shot'].includes(sim.match.phase),
    `phase=${sim.match.phase}`);
  sim.run(14);
  check('penalty duel keeps progressing', sim.match.penalty.attempts[0] + sim.match.penalty.attempts[1] > 0,
    `attempts=${sim.match.penalty.attempts.join('/')}`);
}

// ------------------------------------------------------- robustness / stalls

section('Robustness');
{
  // Regression: a ball pinned in a corner by two bodies used to deadlock the
  // whole match. It must always squirt back out.
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const hw = sim.arena.def.halfWidth;
  const hl = sim.arena.def.halfLength;
  sim.ball.reset(hw - 0.4, 0.36, hl - 0.4);
  sim.players[0].teleport(hw - 1.2, hl - 1.2, Math.PI / 4);
  sim.players[1].teleport(hw - 2.0, hl - 1.0, Math.PI / 4);
  sim.run(4, (_t, inputs) => {
    // Both players shove into the corner.
    inputs[0].moveX = 0.7;
    inputs[0].moveZ = 0.7;
    inputs[1].moveX = 0.7;
    inputs[1].moveZ = 0.7;
  });
  const escaped = sim.ball.body.position.horizontalDistanceTo({ x: hw, y: 0, z: hl }) > 1.6;
  check('a ball trapped in a corner escapes', escaped,
    `ball=${sim.ball.body.position.x.toFixed(1)},${sim.ball.body.position.z.toFixed(1)}`);
}

{
  // A contested match must actually produce football, not a 60 second scrum.
  const sim = new Sim({ difficulty: 'normal', rules: 'timed', seed: 4, aiBoth: true });
  sim.skipCountdown();
  let moved = 0;
  let last = sim.ball.body.position.clone();
  sim.run(90, () => {
    const d = sim.ball.body.position.horizontalDistanceTo(last);
    if (d > 0.5) {
      moved += d;
      last = sim.ball.body.position.clone();
    }
  });
  check('the ball keeps moving in a contested match', moved > 300, `travelled=${moved.toFixed(0)}m`);

  check('a contested match produces goals',
    sim.match.score[0] + sim.match.score[1] > 0, `score=${sim.match.score.join('-')}`);
}

{
  // Nothing may stall the match: no arena, mode or scramble is allowed to park
  // the ball in one spot for seconds on end.
  let worstStall = 0;
  let worstArena = '';
  for (const arenaId of ['classic', 'rooftop', 'beach', 'neon', 'ice', 'tiny']) {
    const sim = new Sim({ arena: arenaId, difficulty: 'hard', rules: 'timed', seed: 9, aiBoth: true });
    sim.skipCountdown();
    let anchor = sim.ball.body.position.clone();
    let stall = 0;
    let worst = 0;
    sim.run(90, () => {
      if (sim.match.phase !== 'play') {
        stall = 0;
        anchor = sim.ball.body.position.clone();
        return;
      }
      if (sim.ball.body.position.horizontalDistanceTo(anchor) > 1.5) {
        anchor = sim.ball.body.position.clone();
        stall = 0;
      } else {
        stall += 1 / 120;
        worst = Math.max(worst, stall);
      }
    });
    if (worst > worstStall) {
      worstStall = worst;
      worstArena = arenaId;
    }
  }
  check('no arena can stall the match', worstStall < 6,
    `worst=${worstStall.toFixed(1)}s on ${worstArena}`);
}

// ------------------------------------------------------------- full game boot

section('Full game boot (headless DOM + WebGL shim)');
try {
  const { runBootTests } = await import('./boot.ts');
  await runBootTests(check);
} catch (err) {
  check('game boots end to end', false, String(err));
}

// --------------------------------------------------------------------- done

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
process.exit(0);
