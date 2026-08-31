import { DECK_SIZE, type Card, type Rank } from '../engine/cards';
import { makeRng, shuffle, type Rng } from '../engine/rng';
import {
  applyAction,
  clone,
  isTerminal,
  knownCards,
  legalActions,
  returns,
} from '../engine/state';
import type { Action, GameState } from '../engine/types';
import type { Agent } from './agent';
import {
  DEFAULT_EVAL_PARAMS,
  deckRankCounts,
  expectedScore,
  gridView,
  policyPriors,
  rolloutAction,
  turnSearchPriors,
  type EvalParams,
} from './heuristic';

/**
 * Information Set MCTS with per-iteration re-determinization.
 *
 * The search never sees a card the agent could not see. Each iteration invents
 * one consistent world (a determinization), walks the shared tree through that
 * world, and backs the result up. Because a different world is sampled every
 * iteration the tree averages over the agent's whole information set rather than
 * assuming one lucky deal, which is what keeps it clear of the strategy fusion a
 * perfect-information search suffers from.
 */

export interface IsmctsOptions {
  name?: string;
  /** Wall-clock budget per decision. Whichever of this and `maxIterations` bites first wins. */
  budgetMs?: number;
  maxIterations?: number;
  /**
   * UCT exploration weight, applied to rewards normalised into [0, 1]. Kept low
   * because sibling rewards here differ by a few hundredths; the textbook 0.7
   * simply drowns the signal.
   */
  explorationC?: number;
  /** Weight of the heuristic progressive bias, which decays as 1/(visits + 1). */
  priorWeight?: number;
  seed?: number;
  /**
   * Turns a rollout may simulate before falling back on `expectedScore`. A full
   * round runs to roughly fifty turns, so the default cuts rollouts well short.
   * Measured self-play prefers that: eight turns buys about six times the
   * iterations, and the extra search is worth more than the extra rollout
   * accuracy.
   */
  rolloutTurnLimit?: number;
  /**
   * Scale the value of turning cards face up by how close an opponent is to
   * going out. The plain evaluation ignores the race entirely.
   */
  raceAware?: boolean;
  /** Evaluation parameters used to RANK moves; defaults to the hand-set ones. */
  evalParams?: EvalParams;
  /**
   * Evaluation parameters used only for the LEAF VALUE, when a rollout runs
   * out of turns and falls back to a static score.
   *
   * Kept separate because the two jobs want opposite things. Ranking moves
   * wants an evaluation that rewards improving the position; estimating a leaf
   * wants an evaluation that is well CALIBRATED to what the position will
   * actually score. Fitting one number for both made play worse.
   */
  leafParams?: EvalParams;
}

const DEFAULTS = {
  budgetMs: 3000,
  maxIterations: 20000,
  explorationC: 0.3,
  priorWeight: 1.5,
  rolloutTurnLimit: 8,
} as const;

/** Round scores in practice sit inside this band; used only to normalise rewards. */
const SCORE_BEST = -20;
const SCORE_WORST = 60;
/** How much of the reward comes from your own score rather than your standing in the field. */
const ABSOLUTE_WEIGHT = 0.7;

/** A stable string for an action, so tree children can be keyed by it. */
export function actionKey(a: Action): string {
  if (a.type === 'discard') return 'q';
  if (a.type === 'place') return `p${a.spot}`;
  if (a.source.kind === 'center') return 'dc';
  if (a.source.kind === 'pile') return 'dp';
  return `dx${a.source.player}`;
}

/**
 * Samples one world consistent with what `viewer` can see: every visible card
 * keeps its place, and everything hidden - face-down grid cards including the
 * viewer's own, the draw pile, discards below the visible top three, and another
 * player's held card - is redealt from the multiset of cards nobody has seen.
 *
 * Because the engine reveals cards as the round goes on, that multiset shrinks
 * and the sampled worlds sharpen. The AI is, in effect, counting cards.
 */
export function determinize(s: GameState, viewer: number, rng: Rng): GameState {
  const t = clone(s);

  const counts = deckRankCounts();
  const seenIds = new Set<number>();
  for (const card of knownCards(s, viewer)) {
    counts[card.rank] -= 1;
    seenIds.add(card.id);
  }

  const unseenRanks: Rank[] = [];
  for (let rank = 1; rank <= 13; rank++) {
    for (let i = 0; i < counts[rank]; i++) unseenRanks.push(rank as Rank);
  }
  // Ids carry no rule meaning, so any unseen id may host any unseen rank. Pairing
  // them this way keeps the id set intact without leaking which rank went where.
  const unseenIds: number[] = [];
  for (let id = 0; id < DECK_SIZE; id++) if (!seenIds.has(id)) unseenIds.push(id);

  const dealt = shuffle(unseenRanks, rng);
  let cursor = 0;
  const take = (): Card => {
    if (cursor >= dealt.length) throw new Error('determinization ran out of unseen cards');
    const card = { rank: dealt[cursor], id: unseenIds[cursor] };
    cursor += 1;
    return card;
  };

  for (const player of t.players) {
    for (const slot of player.grid) if (!slot.faceUp) slot.card = take();
  }
  for (const player of t.players) {
    // Only the top three of each pile are public (section 4).
    const hidden = Math.max(0, player.discard.length - 3);
    for (let i = 0; i < hidden; i++) player.discard[i] = take();
  }
  t.drawPile = t.drawPile.map(() => take());
  // Only redeal an opponent's held card when its rank is genuinely unknown.
  // A card they took from the center or off a discard top was seen by all, so
  // knownCards already counts it and redealing it would break the census.
  if (t.held != null && t.current !== viewer && !t.heldIsPublic) t.held = take();

  if (cursor !== dealt.length) {
    throw new Error(
      `determinization left ${dealt.length - cursor} unseen cards unplaced`,
    );
  }
  t.rngState = rng.state;
  return t;
}

/**
 * Maps final scores onto rewards in [0, 1], one component per player, higher
 * being better. Six-player Skip-Bo Golf is not zero-sum, so each player later
 * maximises their own component (max^n backup).
 *
 * The reward blends the absolute score - which is what the rules actually
 * measure - with where you finished in the field, so that an agent still
 * prefers a mediocre hand that wins to a good hand that loses.
 */
export function rewardVector(scores: readonly number[]): number[] {
  const span = SCORE_WORST - SCORE_BEST;
  return scores.map((score, i) => {
    const clamped = Math.min(SCORE_WORST, Math.max(SCORE_BEST, score));
    const absolute = (SCORE_WORST - clamped) / span;
    let beaten = 0;
    for (let j = 0; j < scores.length; j++) {
      if (j === i) continue;
      if (score < scores[j]) beaten += 1;
      else if (score === scores[j]) beaten += 0.5;
    }
    const standing = scores.length > 1 ? beaten / (scores.length - 1) : 1;
    return ABSOLUTE_WEIGHT * absolute + (1 - ABSOLUTE_WEIGHT) * standing;
  });
}

interface Node {
  /** Whose decision this node is. Fixed by the action path, so stable across worlds. */
  playerToAct: number;
  visits: number;
  /** Summed reward vectors, one component per player. */
  totals: number[];
  children: Map<string, Node>;
  /**
   * How often each action was legal at this node. Legality varies between
   * determinizations - a wave depends on hidden ranks - so UCT must compare an
   * action against the visits it could have had, not against every visit here.
   */
  availability: Map<string, number>;
  /**
   * The heuristic prior for each action, remembered from the world that first
   * offered that action. Keyed by action key rather than held positionally,
   * because legality varies between determinizations and the same index means
   * different things in different worlds.
   */
  priors: Map<string, number>;
}

function makeNode(playerToAct: number, numPlayers: number): Node {
  return {
    playerToAct,
    visits: 0,
    totals: new Array<number>(numPlayers).fill(0),
    children: new Map(),
    availability: new Map(),
    priors: new Map(),
  };
}

/**
 * The prior for each of this world's actions, computing only what is not
 * already known.
 *
 * `policyPriors` costs about 5us, and the descent used to pay it at every node
 * on the path on every visit, so a deep iteration re-derived the same heuristic
 * dozens of times. Measured on the benchmark position, that made a 4000ms
 * search cost 228us per iteration against 152us at 100ms; caching flattens most
 * of that away.
 *
 * The common case is that every action here has been seen before and no
 * heuristic call happens at all. When a world offers an action no previous
 * world did - a wave that only this deal makes legal - one call fills in the
 * missing keys and leaves the rest alone.
 *
 * This does change behaviour slightly, and deliberately: a prior is now fixed
 * from whichever world first offered the action rather than being implicitly
 * re-averaged across worlds every visit, and a cached set need no longer
 * contain the 1.0 that `policyPriors` normalises to. It is what AlphaZero-style
 * searches do, and a 480-game ladder found no regression from it: the four
 * ISMCTS tiers moved +34, +29, +23 and -8 against error bars near 33, with
 * mean scores agreeing, while the three tiers running untouched code moved the
 * other way by the amount that relative shift implies.
 */
export function cachedPriors(
  cache: Map<string, number>,
  s: GameState,
  actions: readonly Action[],
  keys: readonly string[],
): number[] {
  let missing = false;
  for (const key of keys) {
    if (!cache.has(key)) {
      missing = true;
      break;
    }
  }
  if (missing) {
    const fresh = policyPriors(s, actions);
    for (let i = 0; i < keys.length; i++) {
      if (!cache.has(keys[i])) cache.set(keys[i], fresh[i]);
    }
  }
  return keys.map((key) => cache.get(key) as number);
}

/** Scores each player's play area as it stands, for a rollout cut short by its turn limit. */
function estimateScores(s: GameState, params: EvalParams): number[] {
  return s.players.map((p) => expectedScore(gridView(p.grid), params.hiddenEv, params.pMatch));
}

/** Hard ceiling on actions in one rollout, purely as a guard against a runaway loop. */
const ROLLOUT_ACTION_CAP = 4000;

/** Plays the determinized world out under the cheap heuristic policy. */
function rollout(
  start: GameState,
  rng: Rng,
  turnLimit: number,
  raceAware: boolean,
  params: EvalParams,
  leafParams: EvalParams,
): number[] {
  let s = start;
  const firstTurn = s.turnCount;
  let steps = 0;
  while (!isTerminal(s)) {
    if (s.turnCount - firstTurn >= turnLimit) return estimateScores(s, leafParams);
    if (steps >= ROLLOUT_ACTION_CAP) return estimateScores(s, leafParams);
    s = applyAction(s, rolloutAction(s, rng, raceAware, params));
    steps += 1;
  }
  return returns(s);
}

export interface SearchResult {
  action: Action;
  iterations: number;
  /** Visit count of each root action, best first. Useful for debugging and tests. */
  rootVisits: { key: string; visits: number; mean: number }[];
}

/**
 * Runs the search and returns the most-visited root action. Visit count rather
 * than mean value is used because it is the more stable of the two under a
 * budget that may be cut short.
 */
export function ismctsSearch(
  root: GameState,
  player: number,
  options: IsmctsOptions & { signal?: AbortSignal } = {},
): SearchResult {
  const budgetMs = options.budgetMs ?? DEFAULTS.budgetMs;
  const maxIterations = options.maxIterations ?? DEFAULTS.maxIterations;
  const c = options.explorationC ?? DEFAULTS.explorationC;
  const priorWeight = options.priorWeight ?? DEFAULTS.priorWeight;
  const turnLimit = options.rolloutTurnLimit ?? DEFAULTS.rolloutTurnLimit;
  const raceAware = options.raceAware ?? false;
  const params = options.evalParams ?? DEFAULT_EVAL_PARAMS;
  const leafParams = options.leafParams ?? params;
  const rng = makeRng(options.seed ?? (root.rngState ^ (root.turnCount * 2654435761)) >>> 0);

  const rootActions = legalActions(root);
  if (rootActions.length === 0) throw new Error('no legal actions available');
  if (rootActions.length === 1) {
    return { action: rootActions[0], iterations: 0, rootVisits: [] };
  }

  const numPlayers = root.players.length;
  const tree = makeNode(root.current, numPlayers);
  const rootPriors = turnSearchPriors(root, rootActions, raceAware, params);
  const deadline = Date.now() + budgetMs;
  let iterations = 0;

  while (iterations < maxIterations) {
    if (options.signal?.aborted) break;
    // Checking the clock every iteration is cheap next to a rollout.
    if (Date.now() >= deadline) break;
    iterations += 1;

    let s = determinize(root, player, rng);
    let node = tree;
    const path: Node[] = [node];

    // Selection and expansion, both inside this one sampled world.
    for (;;) {
      if (isTerminal(s)) break;
      const actions = legalActions(s);
      if (actions.length === 0) break;
      const keys = actions.map(actionKey);
      for (const key of keys) {
        node.availability.set(key, (node.availability.get(key) ?? 0) + 1);
      }

      // The heuristic's opinion of each action, which both orders expansion and
      // biases early selection. Without it a budget-limited search plays close
      // to randomly, which in this game is markedly worse than simply trusting
      // the heuristic.
      //
      // At the root the held card is real, so the priors are fixed for the whole
      // search and the expensive full-turn search is worth paying for exactly
      // once. Deeper nodes get the cheap one-ply estimate, cached on the node so
      // the same heuristic is not re-derived on every visit.
      const priors =
        node === tree && actions.length === rootPriors.length
          ? rootPriors
          : cachedPriors(node.priors, s, actions, keys);

      let chosen = 0;
      let bestScore = -Infinity;
      // Untried actions come first, best-first, so a short search still looks at
      // the moves actually worth looking at.
      const expanded = keys.some((key) => !node.children.has(key));
      for (let i = 0; i < keys.length; i++) {
        const child = node.children.get(keys[i]);
        let score: number;
        if (expanded) {
          if (child != null) continue;
          score = priors[i];
        } else {
          const tried = child as Node;
          const mean = tried.totals[node.playerToAct] / tried.visits;
          const available = node.availability.get(keys[i]) as number;
          const explore = c * Math.sqrt(Math.log(available) / tried.visits);
          score = mean + explore + (priorWeight * priors[i]) / (tried.visits + 1);
        }
        if (score > bestScore) {
          bestScore = score;
          chosen = i;
        }
      }

      s = applyAction(s, actions[chosen]);
      let child = node.children.get(keys[chosen]);
      if (child == null) {
        child = makeNode(s.current, numPlayers);
        node.children.set(keys[chosen], child);
      }
      node = child;
      path.push(node);
      if (expanded) break;
    }

    const reward = rewardVector(isTerminal(s) ? returns(s) : rollout(s, rng, turnLimit, raceAware, params, leafParams));
    for (const visited of path) {
      visited.visits += 1;
      for (let i = 0; i < numPlayers; i++) visited.totals[i] += reward[i];
    }
  }

  const rootVisits = [...tree.children.entries()]
    .map(([key, child]) => ({
      key,
      visits: child.visits,
      mean: child.visits > 0 ? child.totals[tree.playerToAct] / child.visits : 0,
    }))
    .sort((a, b) => b.visits - a.visits);

  const bestKey = rootVisits[0]?.key;
  const action = rootActions.find((a) => actionKey(a) === bestKey) ?? rootActions[0];
  return { action, iterations, rootVisits };
}

/**
 * An `Agent` backed by ISMCTS. Falls straight through to the single legal action
 * when there is no choice to make, so trivial turns cost nothing.
 */
export function createIsmctsAgent(options: IsmctsOptions = {}): Agent {
  let calls = 0;
  return {
    name: options.name ?? 'ismcts',
    async chooseAction(state, player, opts) {
      calls += 1;
      const seed = ((options.seed ?? 12345) + calls * 7919) >>> 0;
      return ismctsSearch(state, player, {
        ...options,
        seed,
        budgetMs: opts?.budgetMs ?? options.budgetMs,
        signal: opts?.signal,
      }).action;
    },
  };
}
