# Ideas and backlog

Things worth building, parked deliberately rather than forgotten. Each entry
records enough context to pick it up cold: what it is, why it is wanted, what
was already worked out, and what is still open.

Delete an entry when it ships or when it is decided against.

## At a glance

| Priority | Item |
| -------- | ---- |
| High | Cache search priors at node expansion |
| Medium | A stronger opponent above Sage |
| Low | Learned linear evaluator (premise tested and failed) |
| Medium | Self-play value and policy network |
| Low | Re-rate the roster after any engine change |

Keep this table in step with the Status lines below when priorities change.

Settings live in one place: `src/ui/settings.tsx`, opened from the top bar.
Add new preferences there rather than to the top bar.

---



## A stronger opponent above Sage

**Status:** two attempts, **neither worked**. **Priority: medium**, but read the
findings before spending more on it.

**What:** a roster tier genuinely stronger than Sage.

### What has been ruled out, with numbers

**1. More search.** Ada at 150ms to Sage at 2000ms - thirteen times the
thinking - buys about 100 Elo, and the top three tiers sit within a standard
error or two of each other.

**2. Race-awareness in the evaluation** (2026-08-30). Scaling the value of
turning cards face up by how close an opponent is to going out. Over 560 games
it rated 1655 +/-36 against Sage's 1684 +/-29, with a worse mean score and win
rate. Mechanism kept in the code, off by default, tested.

**3. Fitting the evaluation to self-play outcomes** (2026-08-30). This is the
most informative of the three.

`expectedScore` predicts a player's final score from a partial grid, so it can
be regressed against real outcomes. The fit succeeded: held-out prediction
error fell 79.7%, from 412 to 84. **The fitted agent then played markedly
worse** - mean score 7.01 against 3.72 over 200 games, about five standard
errors.

The reason is worth remembering. The evaluation is not used as a predictor, it
is used to RANK candidate moves. Fitting it to outcomes under a competent
policy bakes the value of future good play into the state value: the evaluator
learns that hidden cards tend to work out, and therefore stops working to make
them work out. Better calibration, worse ordering.

Optimising the same two parameters for **playing strength** instead reversed
the direction entirely. The supervised fit wanted HIDDEN_EV near 2.8; a
strength sweep preferred 11 or more, and every point above 7.0 beat the
hand-set 4.44 - the best by 6.12 mean score, about eight standard errors.

**But that gain does not survive search.** The same tuned values inside ISMCTS
at 100ms: 1513 +/-24 against 1487 +/-24, mean score 4.50 against 4.30, win rate
16.5% against 16.8%. Nothing, or very slightly worse.

### What that implies, and it revises an earlier conclusion

The earlier reading was "search is bounded by evaluation quality". That is too
simple. The heuristic ALONE improves enormously with better parameters, and
ISMCTS with the same parameters does not improve at all - because the rollouts
already discover, by playing the round out, the thing the tuning was teaching:
that racing to go out is strong. Search is already compensating for that
particular weakness.

So neither more search NOR this evaluation dimension is the binding constraint
for the searching agents. That is consistent with the tiers clustering: they
may simply be near this game's practical ceiling, which a high-luck game caps
low. Random rates 971 and the best agent 1733 - a spread of about 760 Elo
across the whole range from "no idea" to "searches hard".

### What is left worth trying

1. **Inference from opponent behaviour.** Still untried, and the one lever the
   rollouts cannot substitute for: determinization samples the unseen cards
   uniformly and ignores what opponents' choices reveal. Someone taking a 9 off
   a discard probably wants 9s. Fits the `determinize` seam cleanly.
2. **Search hyperparameters** - `explorationC`, `priorWeight`,
   `rolloutTurnLimit` - set at low budgets and never revisited at high ones.
   Cheap to sweep now.
3. **Establish the ceiling before spending more.** A cheap probe: play a
   perfect-information agent (one that can see the hidden cards) against Sage.
   The gap is an upper bound on what any amount of inference could buy. If it
   is small, stop here.
4. **A learned evaluator.** Split out into its own entries below - see "Learned
   linear evaluator for the rollout leaf" and "Self-play value and policy
   network". Attempt 3 above does not rule this out: it changed leaf value and
   move ranking together, which confounded the test.

### Tooling this produced, all committed

- `npm run fit` - fit the evaluation to self-play outcomes, with a held-out set.
- `npm run fit:sweep` - search the parameters for playing strength instead.
- `npm run fit:arena` - play any candidate parameters against the hand-set ones.

### Methodological lessons

- A ~1.8 standard error signal in this game is not a result: an earlier run put
  Nel 14 Elo above Vin at that confidence and a later one reversed it.
- Optimise the objective you care about. Prediction accuracy and move ranking
  are different objectives, and here they pointed opposite ways.
- Check a result survives the setting it will ship in. The tuning looked like an
  eight-standard-error win until it was measured inside the search that
  actually uses it.

---











## Cache search priors at node expansion

**Priority: high.** Pure speed, no new machinery, and a prerequisite for both
entries below.

**What:** `policyPriors` is recomputed at every node on the descent path on
every single visit ([`src/ai/ismcts.ts`](../src/ai/ismcts.ts), the inner
`for(;;)` in `ismctsSearch`). Compute the prior once when a node is created and
store it on the node, the way AlphaZero-style searches do.

**Why:** measured 2026-08-30, per-iteration cost more than doubles as the tree
deepens, with rollouts disabled so only descent is being timed:

```
 100ms:    682 iters -> 147us each
 250ms:  1,612 iters -> 155us each
1000ms:  5,740 iters -> 174us each
4000ms: 12,521 iters -> 319us each
```

At 5.4us per `policyPriors` call, a deep path re-derives the same heuristic
dozens of times per iteration. The waste grows with budget, so it costs Sage
most.

**Open question, and the reason this needs an arena run rather than just a
benchmark:** caching changes behaviour slightly. Today the prior is implicitly
re-averaged across determinizations because it is recomputed in each one; a
cached prior is fixed from whichever world first expanded the node. That is
what AlphaZero does and it is expected to be fine, but it is a behaviour change
and must be shown neutral on the ladder, not assumed.

**Component costs measured at the same time**, for anyone sizing future work.
Taken with a background arena running, so absolute figures are inflated;
the ratios are the useful part.

| Call | Cost |
| ---- | ---- |
| `legalActions` | 0.2us |
| `clone` | 1.1us |
| `applyAction` | 1.3us |
| `estimateScores` | 2.1us |
| `policyPriors` | 5.4us |
| `rolloutAction` | 7.3us |
| `determinize` | 9.5us |

Note `determinize` is cheap. An earlier guess that it was the bottleneck at
~185us was wrong; do not spend time optimising it.

---

## Learned linear evaluator for the rollout leaf

**Priority: DROPPED to low, and probably do not build it.** The premise was
tested on 2026-08-30 and failed - see below and the running log in
`docs/alphazero-plan.md`.

**What:** replace the two hand-set constants in `expectedScore` with a linear
model over ~30 hand-built features, fitted against self-play outcomes, used
**only at the rollout leaf** and not for ranking moves.

**The premise was that this is not a repeat of the failed fit**, because the
earlier attempt applied fitted values to both jobs at once - leaf value, which
wants calibration, and move ranking, which wants an incentive to improve the
position. `IsmctsOptions.leafParams` was added to separate them.

**Tested 2026-08-30. The premise was wrong.** Fitted values at the leaf ONLY,
ranking left hand-set, 200 games at 150ms: mean score 6.41 +/-0.46 against the
hand-set 2.52 +/-0.36, about **6.7 standard errors worse**. Elo 1469 against
1531. The wiring was verified before concluding.

The mechanism is capacity, not calibration. Fitting two parameters by mean
squared error pushes them toward predicting the average: `pMatch` went from
0.068 to 0.713, which assumes unseen cards usually cancel, so nearly every
position scores alike and the search has nothing to discriminate on. A linear
model over ~30 features is far closer to this failed case than to a network,
which is why this entry is demoted rather than kept as a stepping stone.

The lesson that generalises: **never accept a value function on prediction
error.** Gate on playing strength in the arena. That is now twice in this
project that a large accuracy gain came with a large strength loss.

**Why the leaf is worth attacking:** rounds run 50-103 turns and
`rolloutTurnLimit` is 8, so about **86% of rollouts never reach a real score**
and fall back to the static snapshot. That snapshot prices hidden cards at the
deck average and models no further play. It is the search's opinion almost all
of the time.

**Supporting evidence:** raising `rolloutTurnLimit` from 8 to 24 costs roughly
2.5x the iterations yet still came out ahead on mean score and win rate across
two independent runs. Better leaf values were worth more than the search they
cost. (Whether to simply ship 24 is a separate open decision.)

**Useful property already in place:** `estimateScores` evaluates
`gridView(p.grid)`, which masks face-down cards. The evaluator therefore
already operates on the *information* state rather than the determinized world,
so a learned model drops into that slot without learning to read cards it
should not see.

---

## Self-play value and policy network

**Priority: medium.** The headline attempt at a genuinely stronger opponent.
Large, but the compute budget is agreed.

**What:** an AlphaZero-shaped network with two heads - a value head replacing
the rollout, and a policy head replacing `policyPriors` - trained on self-play
and iterated. ISMCTS stays; the network replaces the two cheap-and-wrong pieces
inside it.

**Why it should help here, in one number:** Sage at 2000ms runs about **3,884
iterations**. That is very few for MCTS, and in an imperfect-information game
those iterations are split between two competing jobs - exploring the move tree
and averaging over deck randomness. In a probed position with 10 legal moves,
2,947 of 3,771 visits went to the favoured move, leaving roughly 90 visits for
each of the other nine, no two from the same determinized deck. Move *ranking*
therefore rests on very thin samples. A policy head narrows the move list,
which is the highest-leverage change available; the value head then removes the
rollout, currently the largest single cost per iteration.

**Compute:** self-play generation is the cost, and it does **not** need the
browser. `src/engine/` imports nothing outside itself, `npm run arena` is
`vite-node`, and `scripts/arena-parallel.mjs` already shards across 18 of this
machine's 20 cores. At the ladder's measured 480 games per 18 minutes, 20 hours
is roughly 32,000 games, or about 14M sampled states at ~450 per game. Ample
for a small network. The real cost driver is *iterating* generations; one or
two probably capture most of the win, because what is being replaced - an
8-turn heuristic rollout ending in a static snapshot - is weak. Games are
independent, so this scales across machines if one box is not enough.

**Deployment:** small enough to ship as a 50-200KB weights file and run as
hand-rolled typed-array matmul in the existing Web Worker. Do not add
TensorFlow.js; the dependency would cost more than the network.

**Expected payoff, stated honestly:** roughly +100 Elo over Sage, plausible
range +50 to +150, with maybe a 30% chance it lands under +50. Bounding
considerations: the ladder already shows sharp diminishing returns (Nel plays
with no search at all and rates 1585 against Sage's 1733), and this is not
literally AlphaZero - determinization causes strategy fusion that a value net
inherits rather than fixes. Note also that in a game this luck-heavy Elo
compresses, so the visible improvement may be **fewer obviously-bad moves**
rather than a markedly harder opponent. That was the original complaint.

---

## Re-rate the roster after any engine change

**Priority: low**, but non-optional whenever a tier's play changes.

**What:** `node scripts/arena-parallel.mjs --games 480 --roster`, then update
the measured `elo`, `eloError`, `meanScore` and `winRate` fields in
[`src/ai/roster.ts`](../src/ai/roster.ts).

**Why it is listed:** any of the three entries above changes Vin, Ada, Rook and
Sage at once, and the published Elos are invalid until the ladder re-runs. The
roster comments record two traps: Vin and Nel are not separable and must not be
reordered on one run's evidence, and a ~1.8 standard error signal is not a
result in this game. Budget roughly 20 minutes per 480-game run.

---
