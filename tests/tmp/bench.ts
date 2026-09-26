import { Sim } from '../harness.ts';
const seeds = [1,2,3,4,5,6,7,8,9,10];
for (const diff of ['easy','normal','hard','expert']) {
  let total = 0;
  for (const seed of seeds) {
    const sim = new Sim({ ai: true, difficulty: diff, rules: 'timed', seed });
    sim.skipCountdown();
    sim.run(75);
    total += sim.match.score[1];
  }
  console.log(diff, (total/seeds.length).toFixed(2));
}
