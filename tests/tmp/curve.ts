import { Sim } from '../harness.ts';
for (const lateral of [1, -1, 0]) {
  const sim = new Sim({ ai: false });
  sim.skipCountdown();
  const p = sim.players[0];
  sim.players[1].teleport(0, 16, 0);
  p.teleport(0, -8, 0);
  sim.ball.reset(0, 0.25, -7.3);
  const rx = -Math.cos(p.yaw), rz = Math.sin(p.yaw);
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  for (let i = 0; i < 160; i++) {
    const inp = Sim.input();
    if (i < 30) { inp.kickHeld = true; if (i === 0) inp.kickPressed = true; }
    if (i < 30) { inp.moveX = rx * lateral * 0.62 + fx * 0.78; inp.moveZ = rz * lateral * 0.62 + fz * 0.78; }
    sim.step([inp, Sim.input()]);
  }
  const b = sim.ball.body.position;
  console.log('lateral', String(lateral).padStart(2), '-> ball x', b.x.toFixed(2), 'z', b.z.toFixed(2),
    'spinY', sim.ball.body.spin.y.toFixed(2), 'kicks', sim.kicks.length);
}
