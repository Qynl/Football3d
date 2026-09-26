import { Sim } from '../harness.ts';
for (const seed of [77, 1, 2, 3, 4]) {
  const sim = new Sim({ aiBoth: true, difficulty: 'hard', rules: 'timed', seed });
  sim.skipCountdown();
  sim.run(150);
  console.log('seed', seed, 'score', sim.match.score.join('-'), 'ballpos', sim.balls[0].body.position.z.toFixed(1));
}
