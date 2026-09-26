import { Sim } from '../harness.ts';
let tot = 0;
for (const seed of [1,2,3,4,5]) {
  const s = new Sim({ ai: true, aiBoth: true, difficulty: 'hard', rules: 'timed', seed });
  s.skipCountdown();
  s.run(90);
  console.log('seed', seed, s.match.score.join('-'));
  tot += s.match.score[0]! + s.match.score[1]!;
}
console.log('total goals', tot);
process.exit(0);
