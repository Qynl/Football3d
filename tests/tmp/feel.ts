import { Sim } from '../harness.ts';
import { InputManager } from '../../src/input/input.ts';

type Opt = { forward?: boolean; sprint?: boolean; kick?: boolean; lob?: boolean; challenge?: boolean };
let kickWas = false;
function inp(o: Opt = {}) {
  const c = InputManager.neutral();
  if (o.forward) c.moveZ = 1;
  c.sprint = !!o.sprint;
  c.kickHeld = !!o.kick;
  c.kickPressed = !!o.kick && !kickWas;
  c.kickReleased = !o.kick && kickWas;
  kickWas = !!o.kick;
  c.lobHeld = !!o.lob;
  c.challengePressed = !!o.challenge;
  return c;
}
const pair = (a: Opt = {}) => [inp(a), inp()] as [ReturnType<typeof inp>, ReturnType<typeof inp>];

function shot(label: string, chargeFrames: number, lob: boolean) {
  const s = new Sim({ ai: false });
  s.skipCountdown();
  const p = s.players[0]!;
  p.position.set(0, 0, -12);
  p.yaw = 0;
  s.ball.reset(0, 0.85, -10.6);
  s.ball.body.velocity.set(0, 0, 0);
  for (let i = 0; i < chargeFrames; i++) s.step(pair({ kick: true, lob }));
  let peak = 0;
  let launch = 0;
  let stopT = -1;
  let n = 0;
  for (let i = 0; i < 900; i++) {
    s.step(pair({ lob }));
    n++;
    const b = s.ball.body;
    peak = Math.max(peak, b.position.y);
    const sp = Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
    launch = Math.max(launch, sp);
    if (stopT < 0 && launch > 4 && sp < 1.2) stopT = n / 120;
  }
  void stopT;
  const b = s.ball.body;
  console.log(
    label.padEnd(22),
    'launch', launch.toFixed(1).padStart(5),
    'peakY', peak.toFixed(2).padStart(5),
    'travelZ', (b.position.z + 10.6).toFixed(1).padStart(6),
    'stop@s', (stopT < 0 ? 99 : stopT).toFixed(1),
  );
}
shot('tap drive', 2, false);
shot('half drive', 35, false);
shot('full drive', 80, false);
shot('full lob', 80, true);
shot('tap lob', 4, true);

// dribbling: run into the ball and see if it stays with you
{
  const s = new Sim({ ai: false });
  s.skipCountdown();
  const p = s.players[0]!;
  p.position.set(0, 0, -14);
  p.yaw = 0;
  s.ball.reset(0, 0.85, -12);
  s.ball.body.velocity.set(0, 0, 0);
  for (let i = 0; i < 240; i++) s.step(pair({ forward: true }));
  const gap = s.ball.body.position.z - p.position.z;
  console.log('dribble 2s (jog)'.padEnd(22), 'playerZ', p.position.z.toFixed(1), 'ballZ', s.ball.body.position.z.toFixed(1), 'gap', gap.toFixed(2));
}
{
  const s = new Sim({ ai: false });
  s.skipCountdown();
  const p = s.players[0]!;
  p.position.set(0, 0, -14);
  p.yaw = 0;
  s.ball.reset(0, 0.85, -12);
  s.ball.body.velocity.set(0, 0, 0);
  for (let i = 0; i < 240; i++) s.step(pair({ forward: true, sprint: true }));
  const gap = s.ball.body.position.z - p.position.z;
  console.log('dribble 2s (dash)'.padEnd(22), 'playerZ', p.position.z.toFixed(1), 'ballZ', s.ball.body.position.z.toFixed(1), 'gap', gap.toFixed(2));
}

// diving header
{
  const s = new Sim({ ai: false });
  s.skipCountdown();
  const p = s.players[0]!;
  p.position.set(0, 0, -12);
  p.yaw = 0;
  s.ball.reset(0, 1.1, -9.5);
  s.ball.body.velocity.set(0, 0, 0);
  for (let i = 0; i < 20; i++) s.step(pair({ forward: true, sprint: true }));
  s.step(pair({ forward: true, sprint: true, challenge: true }));
  let peak = 0;
  for (let i = 0; i < 160; i++) { s.step(pair()); peak = Math.max(peak, s.ball.body.position.y); }
  console.log('dive header'.padEnd(22), 'peakY', peak.toFixed(2), 'endZ', s.ball.body.position.z.toFixed(1), 'playerZ', p.position.z.toFixed(1), 'stamina', p.stamina.toFixed(0));
}

// sprint vs walk over 2 s
for (const sprint of [false, true]) {
  const s = new Sim({ ai: false });
  s.skipCountdown();
  const p = s.players[0]!;
  p.position.set(0, 0, -12);
  const z0 = p.position.z;
  for (let i = 0; i < 120; i++) s.step(pair({ forward: true, sprint }));
  console.log((sprint ? 'sprint 2s' : 'walk 2s').padEnd(22), 'distance', (p.position.z - z0).toFixed(2), 'stamina', p.stamina.toFixed(0));
}
process.exit(0);
