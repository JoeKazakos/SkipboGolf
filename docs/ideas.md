# Ideas and backlog

Things worth building, parked deliberately rather than forgotten. Each entry
records enough context to pick it up cold: what it is, why it is wanted, what
was already worked out, and what is still open.

Delete an entry when it ships or when it is decided against.

## At a glance

| Priority | Item |
| -------- | ---- |
| Medium | A stronger opponent above Sage |

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










