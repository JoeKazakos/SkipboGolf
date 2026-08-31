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

- **2026-08-31 - the three-player experiment: the loop does NOT bootstrap.**

  Four generations at one table size, 2,500 games each, generation N playing
  its games with generation N-1's calibrated network. 4.00 hours. This is the
  only test of ITERATION the project has run; everything before it was a single
  shot, and AlphaZero's whole claim is about iteration.

  Gap to the rollout control, which is invariant to the pool recentering and so
  is comparable across generations:

  | gen | Net elo | Net score | NetCal elo | NetCal score | head spread |
  | --- | ------- | --------- | ---------- | ------------ | ----------- |
  | 0 | -66 | +3.02 | -47 | +1.54 | 0.0864 |
  | 1 | -7 | +0.86 | -57 | +0.98 | 0.0857 |
  | 2 | -82 | +3.45 | -73 | +2.37 | 0.0809 |
  | 3 | -75 | +2.27 | -65 | +1.76 | 0.0797 |

  Mean gap -57.5 Elo. Trend -10.2 Elo per generation: flat to slightly
  downhill. Generation 1 looked like a breakthrough at +59 Elo and was reported
  here as one; generation 2 gave back -75. It was a 1.16 sd blip, and calling
  it a flywheel was wrong.

  The corroborating signal is cleaner than the arena rows and points the same
  way: **the value head's spread falls monotonically every generation**, 0.0864
  to 0.0797. The loop makes the thing it is supposed to sharpen progressively
  blunter. That is what a loop with nothing to bootstrap on looks like - data
  generated by a player no better than the last one carries no better targets.

  One useful side effect: generation 1 onward ran self-play in 30 minutes
  against generation 0's 70, because a 133us network call replaces a ~300us
  rollout at every leaf. The network is a poor evaluator and a fast one.

  Calibration also reversed sign - worth +19 Elo at generation 0 and -50 at
  generation 1 - because the spread-ratio rule assumes the head is only ever
  under-confident, which stops holding as it changes. Left alone mid-experiment
  so the generations stayed comparable, but the rule is wrong as written.

## Verdict on this milestone

**Six configurations, four generations, one parity result, no win.** The best
opponent in this project is the rollout-based ISMCTS that existed before any of
this started.

What the work did establish, and what should outlive it:

- **A ceiling measurement.** An agent that sees the hidden cards rates 310 Elo
  above the identical search that does not, at 7.6 sd. The game is nowhere near
  its skill ceiling and the entire budget sits in hidden-information handling.
- **Four attempts prove where it is NOT.** Improving the leaf value does not
  reach it: masked, revealed, calibrated, shared-encoder, and iterated all fail.
- **The policy head is neutral**, tying its control everywhere - so a learned
  prior is viable in principle, just not profitable at 133us against a 5.4us
  heuristic.
- **Infrastructure that outlives the negative result:** resumable sharded
  self-play, position storage that survives encoder changes, checkpointed
  training, a pooled ladder with untrained baselines, and the ceiling probe.

The next thing to build is `determinize` inference, written up in
`docs/ideas.md`. It attacks the constraint the probe actually found, reuses the
390,000 positions already on disk, and competes against a uniform prior rather
than a competent rollout.

- **2026-08-31 - the blend sweep closes the value-network line properly.**

  Every experiment before this asked whether the network should REPLACE the
  rollout. None asked how much of each is best, which was following AlphaZero's
  recipe without checking its precondition: AlphaZero drops rollouts because its
  value network is far stronger than them, and this one is not. The diagnostics
  said the two were complementary - the network correlating better with the
  outcome overall, 0.49 against 0.41, and far worse at separating the moves
  available now, a sibling ratio of 0.37 against 0.51.

  400 games, one pool, three players, network weight swept:

  | network weight | elo vs control | mean score vs control |
  | -------------- | -------------- | --------------------- |
  | 25% | +1 (0.03 sd) | -0.06 (0.07 sd) |
  | 50% | -31 (1.02 sd) | +0.56 |
  | 75% | -47 (1.43 sd) | +1.44 |
  | 100% | -48 (1.43 sd) | +0.69 |

  Monotone in the network weight. A quarter network ties the control to within
  0.03 standard errors, and every increase past that is worse. There is no
  blend that beats the rollout.

  **That closes the value network with the question properly asked.** Not "full
  replacement failed" but "no weighting of this network's value into the leaf
  helps at all". Seven configurations, four generations, five blend weights.

  The policy head remains neutral - it ties its control everywhere - so a
  learned prior is sound in principle and simply unprofitable at 133us against a
  5.4us heuristic.

- **2026-08-31 - belief weighting fails at every strength, and the milestone
  closes.**

  480 games, identical search and simulation count, the only difference being
  how `determinize` deals the unseen cards. Temperature 0 IS the uniform deal:

  | temperature | elo vs uniform | mean score vs uniform |
  | ----------- | -------------- | --------------------- |
  | 0.25 | -58 (1.60 sd) | +0.35 |
  | 0.50 | -48 (1.19 sd) | +1.26 |
  | 0.75 | -44 (1.07 sd) | +1.56 |
  | 1.00 | -30 (0.71 sd) | +0.83 |

  Uniform is best on BOTH metrics at every temperature. Four comparisons, each
  around one standard error, all pointing the same way.

  The model genuinely predicts better - 22.5% of the cross-entropy against the
  uniform prior on 240,000 held-out rows - and it still does not help. The most
  likely reason is the size of the gap it is trying to close. Uniform leaves
  about 12.8 effective ranks; the model narrows that to about 5.8; the Oracle
  has ZERO uncertainty. Capturing a fifth of the entropy is a long way from
  knowing, and a per-slot independent weighting is not a posterior sample
  anyway - it is a marginal applied slot by slot, which introduces bias the
  search then averages over. That bias apparently costs more than the sharper
  prior earns.

## Final verdict on the milestone

**Nothing beat the rollout-based ISMCTS that existed before this work.** What
was tried, all measured against a control running the identical search at the
identical simulation count:

- 7 value-network configurations - masked, reveal, calibrated, raw, shared
  encoder, policy-only, value-only
- 4 generations of the self-play loop
- 5 leaf blend weights from 0 to 1
- 5 belief temperatures from uniform to full confidence

One parity result, no win.

**Why, as best it can be established.** The Oracle probe says 310 Elo sits in
hidden-information handling, and the roster says 13.5x more search buys 29 Elo
inside its own error bars. Information is worth roughly an order of magnitude
more than compute here. Every value-network variant was spending effort on the
axis that had already stopped paying, and the one attempt on the right axis
closed only a fifth of the entropy - not enough to matter, and biased in a way
that cost more than it earned.

**What survives and is worth keeping:**

- The ceiling measurement, which reframes the game: not near its skill ceiling,
  and the headroom is in information rather than evaluation.
- Prior caching, which flattened per-iteration cost with tree depth: 319us to
  64us at Sage's budget, ladder-neutral.
- Simulation counts replacing millisecond budgets, so a tier's strength is a
  property of the tier and not of the machine or the table size.
- Resumable sharded self-play, position storage that outlived four encoder
  changes without regenerating data, checkpointed training, a pooled ladder
  with untrained baselines, the perfect-information probe, and the
  hidden-hand inference probe.

**The discipline lesson, recorded because it recurred all day.** Every
mechanism proposed here was refuted by measurement: smoother outputs, the mean
offset, sibling swings, the reveal encoder, generation 1's apparent climb,
belief weighting. Prediction quality never once predicted playing strength. The
arena decided every question, and the diagnostics - however well reasoned -
decided none of them.

- **2026-08-31 - the equal-TIME test, which was the last condition that could
  have changed the verdict. It does not.**

  Every earlier arena fixed the simulation count, which is the right control for
  evaluation quality and the wrong one for a shipped opponent - it discards the
  network's one real advantage. A 133us forward pass replaces a ~300us rollout,
  and measured at a 400ms clock on a mid-game position:

    rollout   507 iterations
    network  1281 iterations   -> 2.53x more search in the same time

  480 games at a fixed 400ms clock:

  | agent | elo | mean score |
  | ----- | --- | ---------- |
  | Rollout | 1516 | 4.61 |
  | Mix50 | 1508 | 4.82 |
  | Mix100 | 1476 | 7.03 |

  The pure network is 4.07 standard errors WORSE on mean score while searching
  two and a half times more. An even blend ties, at 0.20 and 0.37 sd. The extra
  thinking does not come close to covering the deficit, which is consistent with
  what the roster already said: 13.5x more search buys 29 Elo here, so 2.53x is
  worth single digits and the deficit is far larger than that.

  This was the last untested condition in which the network could have won, and
  it is the condition the product actually runs under. The verdict stands.

- **2026-08-31 - the ceiling decomposed, and the 310 Elo I kept quoting was 91%
  unreachable.**

  The full oracle sees ALL hidden cards, including its OWN face-down ones. I
  quoted its advantage all day as headroom for better inference. That was wrong:
  your own face-down cards are dealt at random and leak from nothing - no
  opponent behaviour, no visible structure - so no model can ever recover them.
  Only what OPPONENTS hold is chaseable, because their choices leak it.

  Three oracles against one control, 300 games:

  | agent | elo | mean score | vs control |
  | ----- | --- | ---------- | ---------- |
  | OracleAll | 1718 | -3.71 | +283 elo (5.72 sd) |
  | OracleSelf | 1620 | -0.61 | +185 elo (3.90 sd) |
  | OracleOpp | 1460 | 7.17 | **+25 elo (0.49 sd)** |
  | Normal | 1435 | 7.00 | - |

  **Knowing what every opponent holds is worth 25 Elo at half a standard error,
  and nothing at all on mean score.** Knowing your own face-down cards is worth
  185 Elo at 3.9 sd. Nine per cent of the gap is reachable by any model, ever.

  This reframes the entire milestone. The recommendation I gave repeatedly -
  stop working on evaluation, go after hidden-information inference, there are
  310 Elo there - was chasing a number that is 91% composed of information
  nobody can obtain. The belief model closing a fifth of the entropy on
  opponents' hands was competently chasing a 25-Elo prize, which is why it
  produced nothing: a fifth of 25 Elo is invisible next to the bias that
  weighting the deal introduced.

  **The honest conclusion is that this game's ISMCTS is close to its practical
  ceiling.** Random rates 961 and the best searching tier 1706; 13.5x more
  search buys 29 Elo inside its error bars; perfect knowledge of every opponent
  buys 25 Elo at half a standard error. There is very little left on the table
  for any method, learned or otherwise, and that is a finding rather than a
  failure - it is the thing that should have been measured on day one.

- **2026-08-31 - the scaled attempt: 108k parameters, 387k pooled positions.**

  The earlier conclusion was reached at a scale that did not earn it: 64k
  parameters on about 110k samples per generation. Self-play data does not go
  stale, so the four 3-player generations pool into 387,278 samples at no extra
  compute, and the network was sized up 1.7x.

  Training, 20 epochs:

    policy loss  1.5333 -> 1.3625   best in the project, against 1.4566 before
    value loss   0.6419 -> 0.6384   identical to every previous run

  Arena, equal simulations, 480 games (small network in brackets):

  | mix | elo vs control | mean score |
  | --- | -------------- | ---------- |
  | 25% | +12, 0.36 sd (was +1) | -0.03, 0.05 sd |
  | 50% | -5, 0.15 sd (was -31) | -0.15, 0.23 sd |
  | 100% | -35, 1.21 sd (was -48) | +1.33, 2.04 sd |

  Arena, equal TIME at a 400ms clock, 480 games:

  | agent | elo | mean score |
  | ----- | --- | ---------- |
  | Rollout | 1518 | 3.23 |
  | Mix50 | 1498 | 3.63 |
  | Mix100 | 1484 | 5.05 |

  **Scale helped and did not cross the line.** Mix50 went from -31 Elo to -5 and
  now holds the nominally best mean score in the pool, but every difference is
  inside noise. Blends TIE the rollout at equal simulations; at equal time the
  rollout wins on both metrics, because a bigger network is slower per forward
  pass and buys fewer extra iterations than the small one did.

  **The value loss is the finding.** 0.6384, identical across four generations,
  two architectures, two encoders, and now 1.7x capacity on 3.5x the data. That
  is not a capacity or data shortage; it is the intrinsic limit of the target. A
  mid-game position does not determine the final reward, because the reward
  depends on draws nobody can see. The policy head kept improving - 1.4566 to
  1.3625 - because move quality IS learnable from a position. The value is not.

  Which is the ceiling probe's finding arriving from the other direction: this
  game's uncertainty is dominated by cards that leak from nothing.
