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
| M0 | Prior caching and a repeatable benchmark harness | not started |
| M1 | Feature encoding and network runtime | not started |
| M2 | Training loop and checkpointing | not started |
| M3 | Self-play data generation, resumable | not started |
| M4 | Network-backed ISMCTS agent | not started |
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
