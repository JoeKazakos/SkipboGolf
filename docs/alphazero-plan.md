# AlphaZero-style evaluator: plan and running log

Goal: replace the two weak pieces inside ISMCTS - the truncated heuristic
rollout and the recomputed heuristic prior - with a small trained network, and
produce a roster tier meaningfully stronger than Sage.

**This document is the resume point.** Every milestone records what was decided,
what shipped, and what was measured. Read it before picking the work up cold.

## Why this and not more search

Measured 2026-08-30, and recorded at greater length in `docs/ideas.md`:

- Sage at 2000ms runs about **3,884 iterations**. That is very few for MCTS.
- Those iterations are split between two competing jobs: exploring the move tree
  and averaging over deck randomness. In a probed position with 10 legal moves,
  2,947 of 3,771 visits went to the favoured move, leaving ~90 visits each for
  the other nine, no two from the same determinized deck.
- Rounds run 50-103 turns against a `rolloutTurnLimit` of 8, so about **86% of
  rollouts never reach a real score** and fall back to a static snapshot.
- Per-iteration cost more than doubles as the tree deepens (147us -> 319us),
  because `policyPriors` is recomputed at every node on every visit.

A policy head narrows the move list, which is the highest-leverage change
available at this iteration count. A value head removes the rollout, the largest
single cost per iteration. Prior caching makes both cheaper still.

Expected payoff, stated honestly: roughly +100 Elo over Sage, plausible range
+50 to +150, with perhaps a 30% chance of landing under +50. In a game this
luck-heavy Elo compresses, so the visible win may be fewer obviously-bad moves
rather than a markedly harder opponent.

## Architectural decisions, made up front

**1. Value head predicts the reward vector, not raw scores.** `ismctsSearch`
backs up `rewardVector(...)`, already in [0,1]. Predicting that directly means
the net drops into the exact slot `rollout` occupies, and a bounded target is
far friendlier to train.

**2. Everything is rotated so the player to act is index 0.** Seats are padded
to `MAX_SEATS = 7`, with an occupancy flag, so one network serves every
supported table size (2-7 players).

**3. Fixed policy action space of 19**, indexed relative to the player to act:

```
 0      draw center
 1      draw pile
 2..7   draw from the discard of the seat at offset 1..6
 8..17  place at spot 0..9
 18     discard
```

Offset rather than absolute seat index, so the policy generalises across seats.

**4. Self-play stores compact positions, not feature vectors.** Features are
recomputed at training time. This costs a little CPU and buys the ability to
change the feature encoding **without regenerating any self-play data**, which
is the difference between a one-hour and a twenty-hour iteration.

**5. The encoder reads only the information state, enforced by a test.**
`features(s, viewer)` must equal `features(determinize(s, viewer), viewer)` for
any determinization: same visible cards, scrambled hidden ones, identical
output. This is mechanical proof of no leakage and is non-negotiable.

**6. No TensorFlow.js.** Hand-rolled Float32Array matmul. The net must ship in
the existing Web Worker; the dependency would cost more than the network.

**7. Hard performance budget: one forward pass under 50us**, benchmarked, not
assumed. The rollout it replaces costs 300-500us, so this is the ceiling that
keeps the swap a clear win.

## Milestones

| # | Milestone | Status |
| - | --------- | ------ |
| M0 | Prior caching and a repeatable benchmark harness | **done**, ladder-neutral |
| M1 | Feature encoding and network runtime | **done**, 343 features, 5.96us |
| M2 | Training loop and checkpointing | **done**, gradient-checked |
| M3 | Self-play data generation, resumable | **done**, 19.6 samples/s |
| M4 | Network-backed ISMCTS agent | **done**, behind an option |
| M5 | Policy head first, keeping heuristic rollouts | not started |
| M6 | Value head, generation loop, roster re-rating | not started |

### M0 - Prior caching and benchmark harness

Backlog item, high priority, and a prerequisite: it speeds up every self-play
game we are about to generate. Cache the prior on a node when it is created
rather than recomputing it on every visit. Must be shown **neutral on the
ladder**, not merely faster, because a cached prior is fixed from whichever
determinized world first expanded the node instead of being implicitly
re-averaged.

Also lands `npm run bench`, so every later performance claim is measured the
same way and under stated load.

### M1 - Feature encoding and network runtime

- `src/ai/nn/features.ts` - information state to `Float32Array`, fixed length.
- `src/ai/nn/net.ts` - MLP forward pass, value and policy heads.
- `src/ai/nn/serialize.ts` - weights to and from a compact binary file.

Gate: the determinization-invariance test passes, and the forward pass is under
50us on this machine.

### M2 - Training loop and checkpointing

Backprop, Adam, minibatching, all in plain TypeScript. Checkpoints save after
every epoch and resume exactly, because the user asked for training that can be
stopped and continued. Gate: recovers a known synthetic function, and a
checkpoint round-trips bit-identically.

### M3 - Self-play data generation, resumable

Shards across processes the way `scripts/arena-parallel.mjs` already does.
Generation 0 bootstraps from the current ISMCTS with heuristic rollouts, taking
policy targets from root visit counts and value targets from the final reward
vector. Every shard writes atomically and the run manifest records what is
finished, so an interrupted run resumes rather than restarts.

### M4 - Network-backed ISMCTS agent

Plug the evaluator into `ismctsSearch` behind an option: value replaces the
rollout, policy replaces the prior. Existing agents must be untouched and the
existing tests must still pass.

### M5 - Policy head first, then the value head

**Restructured 2026-08-30 after a negative result** (see the running log). Train
and ship the POLICY head first, keeping the existing heuristic rollouts, and
only then add the value head.

Two reasons. First, it de-risks: the leaf-only fitting experiment showed a
low-capacity calibrated value function actively harms play, so the value head
carries more risk than the policy head. Second, the policy head was already the
better bet on the analysis - at ~3,884 iterations, narrowing the move list
matters more than valuing leaves precisely.

### M6 - Generation loop, evaluation, roster re-rating

Iterate: self-play, train, arena against the previous generation, accept or
reject. Then re-rate the whole roster and ship the new tier. One or two
generations probably capture most of the win, because what is being replaced is
weak; the plan does not assume ten.

## Pending, and BLOCKED until generation 0 self-play finishes

`vite-node` compiles from source at process start, and generation 0 spawns 240
shard processes over several hours. Editing anything in the self-play import
closure mid-run would mix code versions across shards. That closure is:

  engine/*, ai/agent.ts, ai/heuristic.ts, ai/ismcts.ts,
  ai/nn/{contracts,evaluator,features,net,checkpoint,positions,selfplay,selfplay-shard}.ts

Those files are FROZEN until the run completes. Safe to edit meanwhile: docs,
scripts, ui/*, roster.ts, arena.ts, net-arena.ts, train-run.ts, load.ts.

**The one change waiting on this:** self-play must accept `SP_WEIGHTS` and pass
an evaluator into `ismctsSearch`, so generation 1 plays its games with
generation 0's network. `scripts/generation.mjs` already sets that variable and
`selfplay-shard.ts` does not yet read it. Without this the loop is one round of
supervised imitation rather than AlphaZero, so it is not optional.

## Pending: convert the roster from time budgets to iteration counts

**Requested 2026-08-30, and not yet done** because it needs a quiet machine to
measure and self-play was saturating all 18 cores.

Self-play already uses a fixed simulation count rather than a clock, because a
time budget made a replayed shard produce different data. The same argument
applies to the shipped tiers, with an extra benefit: a tier's strength becomes
a machine-independent property, so its Elo no longer depends on how fast the
box that measured it happened to be. Today Vin is "40ms", which is a different
opponent on a laptop than on a workstation.

The plan: give each ISMCTS profile an `iterations` count as its primary knob,
measured on an idle machine to match its current budget, and KEEP `budgetMs` as
a safety cap. Iterations alone would mean a slow phone thinks for ten seconds;
the cap bounds the wait while the iteration count sets the strength. Then
re-rate the ladder, since the tiers will have shifted slightly.

## How to run it

```
npm run bench                       # component costs and per-iteration cost
npm run selfplay -- --gen 0 --games 6000 --iterations 400 --shards 240
TR_GENERATION=0 TR_EPOCHS=40 npm run train
NA_WEIGHTS=training/gen000/weights.bin NA_GAMES=200 npm run net:arena
```

All three are resumable or repeatable. Self-play skips shards already on disk,
training resumes from the newest checkpoint in the generation's directory, and
the arena is a fresh measurement every time.

## Running log

Newest last. Record measurements, not impressions.

- **2026-08-30** - Branch `feat/alphazero` opened. Plan and contracts written.

- **2026-08-30 - the leaf-only fitting experiment FAILED, decisively.** This
  matters for the whole project, so read it before trusting the value head.

  Background: `expectedScore` serves two jobs, leaf value and move ranking. An
  earlier attempt fitted its two parameters to self-play outcomes and played
  worse, but it changed both jobs at once, so the test was confounded. The
  hypothesis was that calibration is right for the leaf and wrong for ranking.
  `leafParams` was added to separate them and the hypothesis was tested
  directly: fitted values (ev 2.765, p 0.7132) at the LEAF ONLY, ranking left
  on the hand-set values, 200 games at 150ms.

  ```
  agent    games   elo  +/-  mean score  stderr  win rate
  handset    600  1531   33        2.52    0.36     18.7%
  fitted     600  1469   33        6.41    0.46     14.7%
  ```

  Mean score 6.41 against 2.52 is about **6.7 standard errors worse**. The
  hypothesis is dead. Wiring was verified before concluding: `leafParams` feeds
  only `estimateScores` at the rollout cutoff, while `rolloutAction` and the
  priors keep the hand-set values.

  **Mechanism, and why it does not sink the network.** Fitting TWO parameters
  by mean squared error drives them toward predicting the average outcome:
  `pMatch` moved from 0.068 to 0.713, which amounts to assuming unseen cards
  usually cancel, so nearly every position scores alike. A near-constant leaf
  value gives the search nothing to discriminate on. The failure is a capacity
  problem, not evidence that calibrated leaf values are wrong in principle -
  AlphaZero's value head is precisely a calibrated outcome predictor and it
  works, because it has the capacity to be calibrated AND discriminative. Two
  parameters can only buy calibration by flattening.

  **What changes as a result:**
  1. The standalone "learned linear evaluator" step is DEMOTED. A linear model
     over ~30 features sits much closer to the failed 2-parameter case than to
     a network, so it is a poor early signal. Skip it.
  2. M5 is restructured to train the POLICY head first, keeping heuristic
     rollouts, so the lower-risk half is validated on its own.
  3. **No value function is accepted on prediction error, ever.** Every gate is
     playing strength measured in the arena. This is now the second time in
     this project that a large improvement in prediction accuracy came with a
     large loss in strength.

- **2026-08-30 - M0 through M4 landed; generation 0 self-play started.**

  M0, prior caching. Descent cost per iteration fell from 147/174/319us at
  100/1000/4000ms to 56/56/64us. The absolute gain matters less than the shape:
  cost used to grow 2.2x with tree depth and now grows 1.14x, so the win is 5x
  at Sage's budget and almost nothing at Vin's. A 480-game ladder found no
  regression - the four ISMCTS tiers moved +34, +29, +23 and -8 against error
  bars near 33, with mean scores agreeing.

  M1, feature encoding. 343 features, 5.96us, verified independently over 6,145
  (position, viewer, world) triples: no leak, no non-finite values.

  M2, network and training. 63,898 parameters at [128, 128]. The gradient check
  initially reported 0.44 relative error and was WRONG: a central difference
  across a ReLU kink measures a chord over a corner. Excluding coordinates
  whose perturbation flips an activation, the error is 0.00046.

  M3, self-play. Measured 19.6 samples/s across 18 workers at 400 simulations
  per decision, so about **14 hours per million samples**. The pilot produced
  4,801 samples from 72 games - about 67 samples per game.

  M4, the network in the search. Behind `IsmctsOptions.evaluator`; with it
  absent the search is bit-identical, which the roster's ratings depend on.

  Pipeline validated end to end. Training on the 72-game pilot drove policy
  loss from 2.68 to 1.76 against log(19) = 2.94 for a uniform prior, so the
  policy head learns. Value loss barely moved, which is exactly what 72 games
  should look like: **the value head needs independent OUTCOMES, and every
  sample within one game shares one.** That is the number to watch as the real
  generation lands - 6,000 games rather than 72.

  Generation 0 running: 6,000 games, 400 simulations, 240 shards, expected
  ~400k samples in about 5.7 hours.

- **2026-08-31 - generation 0 trained, and the network does not beat its
  control. Three variants tried; the standing tally is below.**

  All arenas run the identical search at the identical simulation count on
  every row, so a gap between a network row and the Rollout row is the network
  and nothing else.

  | variant | vs Rollout, elo | vs Rollout, mean score |
  | ------- | --------------- | ---------------------- |
  | policy head only | +3 (0.05 sd) | +0.31 (0.34 sd) - ties |
  | masked value, calibrated | -3 (0.06 sd) | +0.92 (1.11 sd) |
  | masked value, raw | -85 | +4.15 (4.38 sd) |
  | reveal value, calibrated | -65 (1.59 sd) | +2.21 (2.86 sd) |
  | reveal value, raw | -142 (2.74 sd) | +5.13 (6.05 sd) |

  **The policy head is neutral everywhere. The value head hurts everywhere.**

  Two diagnoses were made and both were wrong in the arena.

  *Calibration.* The value head regresses to the mean, spread 0.079 against the
  outcomes' 0.174, so UCT's fixed exploration term ran at 1.47x the value
  signal where the static estimate ran at 0.63x. Stretching by 2.2x was worth
  about 59 Elo - real - but only reached parity, because scaling lifts the
  global and sibling spreads together and cannot change their ratio.

  *Revealing the sampled world.* ISMCTS evaluates inside a world it drew, so a
  masked encoder returns the same value in every world and cannot contribute
  the world-specific signal a rollout does. Training an encoder that sees the
  sampled cards raised sibling spread from 0.0341 to 0.0511 and its ratio to
  0.57, past the rollout's 0.51 - and then played 2.86 standard errors WORSE.

  The likeliest reason for that last one, untested: the reveal network trains on
  real hidden layouts, which are not uniform, because what a player holds
  correlates with the choices that got them there. It is then used on
  determinized layouts drawn uniformly from the unseen multiset. So it
  extrapolates a sharp mapping onto inputs unlike its training data and answers
  confidently about worlds that never occur, where a rollout handed the same
  fake world degrades gracefully because it simulates rather than extrapolates.

  **What this says about where the remaining value is.** The perfect-information
  probe found 310 Elo at 7.6 sd between an agent that sees the hidden cards and
  the identical search that does not. That budget is entirely in
  hidden-information handling, and three attempts have now confirmed it is not
  reachable by improving the leaf VALUE. The untried lever is inference:
  `determinize` samples the unseen cards uniformly and ignores everything
  opponents' choices reveal. Someone taking a 9 off a discard pile probably
  wants 9s. `docs/ideas.md` has listed this as untried since before this project
  began, and it addresses the constraint the probe actually identified.

  Also measured, and it corrects a plan assumption: a forward pass costs 133us
  for the flat network and 186us for the shared one, not the 50us budgeted. The
  earlier 26us figure came from an agent benchmark that does not reproduce -
  63,898 multiply-accumulates in 26us implies 2.5 GMAC/s, which scalar
  JavaScript over Float32Array does not reach. The saving against a 300us
  rollout is therefore about 1.6x, not 10x.

- **2026-08-31 - the shared per-seat architecture, trained on the same data.**

  Joe's design: one sub-network reads a single seat's 181 features and emits a
  20-number embedding; it is applied to all seven seats with the same weights,
  and the embeddings plus 63 table features feed the head. It corrects a real
  flaw in the first encoder, which gave the viewer's grid 140 raw features and
  each opponent only 16 hand-picked summaries - so the network could learn to
  read its own play area and never anyone else's, and my choice of summaries
  was a ceiling on what it could discover about opponents.

  37,902 parameters against the flat network's 63,898, and the sub-network sees
  seven grids per position rather than one.

  Trained on the identical 390,443 positions with the identical held-out split.
  After 30 epochs, with the reveal encoder:

  | network | value loss | policy loss |
  | ------- | ---------- | ----------- |
  | flat, reveal, 40 epochs   | 0.6381 | 1.5541 |
  | shared, reveal, 30 epochs | 0.6350 | 1.5572 |

  The shared network has the better value head - the first architecture change
  in this project to move that number the right way - on fewer parameters and
  fewer epochs. Whether it converts into playing strength is the arena's
  question, and every previous better-predictor has failed it.

  Per table size it shows the same healthy shape as the flat network (2p 2.031
  rising to 7p 2.248), which is the larger action space rather than
  undertraining, so the shared encoder transfers across counts as intended.

- **2026-08-31 - the pooled ladder, and where generation 0 actually landed.**

  Joe's point, and it fixed a real reporting flaw: `summarise` recenters every
  pool on 1500, so the same rollout control read 1513, 1544, 1535 and 1574
  across four separate arenas. Cross-run Elo here was never comparable; mean
  score, being points in the game, always was. Everything now plays in one pool.

  240 games, one rating fit, 400 simulations for every network row:

  | agent | elo | mean score |
  | ----- | --- | ---------- |
  | Rollout (control) | 1636 | 2.51 |
  | Rook | 1617 | 2.18 |
  | Ada | 1608 | 3.48 |
  | **Gen0** flat, masked, calibrated | **1594** | 3.49 |
  | Gen0Rev flat, reveal | 1543 | 6.17 |
  | Gen0ShRev shared, reveal | 1540 | 7.21 |
  | Vin | 1525 | 6.46 |
  | UntrainedSh | 1495 | 8.54 |
  | Nel | 1435 | 10.44 |
  | UntrainedOff | 1260 | 20.51 |
  | Untrained | 1248 | 21.48 |

  **Training works.** Gen0 is +346 Elo at 7.4 sd over the same network with
  random weights. That was never in evidence before this run.

  **Nothing beats the control.** Gen0 comes closest at -42 Elo and +0.98 mean
  score, both about 0.9 sd - parity, not a win. Every variant meant to improve
  on it is worse: reveal -93 Elo, shared -96, both over 3 sd on mean score.

  **The best configuration is the first one built** - flat encoder, masked,
  value calibrated by 2.2x. Both later ideas made it worse.

  Three hypotheses were offered for why the untrained SHARED network rates 247
  Elo above the untrained flat one, and all three were wrong: smoother outputs
  (their global spreads match, 0.0356 against 0.0351), a value mean offset (the
  shifted control moved 12 Elo, 0.2 sd), and smaller sibling swings (the shared
  net's sibling spread is LARGER, 0.0347 against 0.0210). It is unexplained.
  Since it concerns two untrained networks it does not block anything, but the
  pattern - three confident mechanisms, three refutations - is the honest
  summary of this whole milestone's diagnosis record.

  **Where this leaves the value head.** Four attempts, one parity result, no
  win. Meanwhile the perfect-information probe puts 310 Elo at 7.6 sd on the
  table and locates all of it in hidden-information handling. `determinize`
  still samples the unseen cards uniformly and ignores everything an opponent's
  choices reveal; someone taking a 9 off a discard pile probably wants 9s. That
  is the lever the measurement actually points at, and it is untouched.
