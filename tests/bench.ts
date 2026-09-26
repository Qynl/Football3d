/**
 * AI difficulty benchmark (dev tool, not part of `npm test`).
 *
 * Runs the AI against a completely passive human for 75 seconds across ten
 * seeds and prints the average goals per difficulty. Use it after touching
 * shooting, physics or AI tuning: the numbers should stay monotonic
 * (easy < normal < hard < expert) and expert should stay under ~6.
 *
 *   node --import ./tests/loader.mjs tests/bench.ts
 */
import { Sim } from './harness.ts';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const difficulties = ['easy', 'normal', 'hard', 'expert'] as const;

for (const difficulty of difficulties) {
  let total = 0;
  for (const seed of seeds) {
    const sim = new Sim({ ai: true, difficulty, rules: 'timed', seed });
    sim.skipCountdown();
    sim.run(75);
    total += sim.match.score[1]!;
  }
  console.log(difficulty.padEnd(7), (total / seeds.length).toFixed(2));
}
process.exit(0);
