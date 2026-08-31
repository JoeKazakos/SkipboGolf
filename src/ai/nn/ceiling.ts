/**
 * How much is actually left to win?
 *
 * An agent that SEES the hidden cards is an upper bound on what any amount of
 * better inference, evaluation or search could ever buy, because every one of
 * those is an attempt to approximate exactly the information it is handed. If
 * it barely beats the ordinary search at the same simulation count, then this
 * game's practical ceiling is the constraint, and no network will move it.
 *
 * `docs/ideas.md` has listed this as the thing to run before spending more,
 * and generation 0 is the moment it is worth the twenty minutes.
 *
 * Usage: CE_GAMES=200 npm run ceiling
 */
import type { Agent } from '../agent';
import { playIndexedGame, summarise, formatTable } from '../arena';
import { createIsmctsAgent } from '../ismcts';
import { createAgentForProfile, profileById } from '../roster';

declare const process: { env?: Record<string, string | undefined> } | undefined;

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const games = Number(env.CE_GAMES ?? 200);
  const iterations = Number(env.CE_ITERATIONS ?? 400);
  const seed = Number(env.CE_SEED ?? 515151);

  const common = { maxIterations: iterations, budgetMs: 3_600_000, seed: 4242 } as const;
  const ladder: Agent[] = [
    createIsmctsAgent({ ...common, name: 'Oracle', perfectInfo: true }),
    createIsmctsAgent({ ...common, name: 'Normal' }),
    createAgentForProfile(profileById('rook'), 99),
    createAgentForProfile(profileById('ada'), 99),
    createAgentForProfile(profileById('vin'), 99),
    createAgentForProfile(profileById('nel'), 99),
  ];

  console.log(`ceiling probe: ${games} games, ${iterations} simulations per decision`);
  console.log('  Oracle searches the true position; Normal samples a world, as usual.');

  const results = [];
  for (let g = 0; g < games; g++) {
    results.push(await playIndexedGame(ladder, g, { seed, seatCount: 6 }));
    if ((g + 1) % 20 === 0) console.log(`  ${g + 1}/${games} games`);
  }
  console.log(formatTable(summarise(results)));
  console.log(
    '\nOracle minus Normal is the WHOLE budget available to better inference,\n' +
      'evaluation and search combined. Nothing can win more than that gap.',
  );
}

void main();
