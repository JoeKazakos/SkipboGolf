# Ideas and backlog

Things worth building, parked deliberately rather than forgotten. Each entry
records enough context to pick it up cold: what it is, why it is wanted, what
was already worked out, and what is still open.

Delete an entry when it ships or when it is decided against.

---

## Rate the human player

**Status:** wanted, not started. Raised 2026-08-29; deferred deliberately, not
blocked on anything.

**What:** track the player's own results across rounds and give them a rating on
the same scale as the AI roster, so "am I getting better?" has an answer.

**Why:** the opponents already carry measured ratings, so the player has a
strength ladder to be placed against but no place on it.

### Already worked out

Nothing exists yet: the app has no persistence at all (no `localStorage`, no
match history). Every round is standalone.

The precision question was answered, so do not re-derive it. The AI ladder is
the empirical noise floor: about 103 games per agent produced bootstrap error
bars of +/-26 to +/-48 Elo, mean about +/-35. Error falls as 1/sqrt(games):

| games | precision |
| ----- | --------- |
| 10    | +/-110    |
| 20    | +/-79     |
| 30    | +/-65     |
| 50    | +/-50     |
| 100   | +/-36     |
| 200   | +/-25     |

Against the gaps that actually need resolving - Pip to Dot is 303 Elo, Dot to
Nel 278, Nel to Vin 88, Vin to Sage 89 - that gives:

- about 20 games to place someone confidently in a strength band
- about 50 games for a number worth quoting
- about 100 games to match the precision of the AI ratings themselves
- separating yourself *within* the Strong/Expert tier is not realistically
  achievable, because those tiers are only about 90 Elo apart and the ladder
  could not separate Rook from Ada either

A six-player round yields five pairwise results, not one, which is why these
counts are lower than chess intuition suggests.

### Design sketch

- Persist round results to `localStorage`.
- Fit the player's rating against the AI ratings as **fixed anchors**, rather
  than refitting everyone jointly. Far more stable, and the anchors are already
  measured.
- Show progress honestly: "12 games in, +/-95, provisional".
- Show a **band** rather than a number until the error bar is tight enough to
  justify one, matching how the setup screen already leads with strength rather
  than Elo.

### Open questions

- Does a rating reset when the roster is re-measured, or carry over? Re-running
  the ladder moves the anchors.
- Only count games against a varied mix of opponents? Twenty wins over Pip say
  almost nothing, and a naive fit would happily produce a confident wrong number.
- Anything to show when a player deliberately farms a weak table?

### Caveat to keep in view

This is a single-round, high-luck game. A rating here will always be noisier
than in a low-variance game, and no amount of bookkeeping fixes that. Whatever
gets built should be honest about that rather than projecting false precision.

---

## Tighten the error bars on the CPU ratings

**Status:** wanted, not started. Raised 2026-08-29. Pairs with "Rate the human
player": that feature fits the player against these ratings as fixed anchors,
so the anchors want to be firm first.

**What:** get the roster's Elo error bars well below their current +/-26 to
+/-48, so adjacent tiers are actually separable.

**Why:** at 120 games the four searching tiers sit within about 90 Elo of each
other with error bars near 30. Rook and Ada differ by 4 Elo, which is noise.
The roster currently collapses them into shared strength bands for exactly this
reason. Firmer numbers would either justify separating them or prove they
should be merged outright.

### What it would take

Error falls as 1/sqrt(games), so halving the bars needs four times the games:
roughly 480, which is about five hours serially at current settings. Three ways
to do better than brute force, best first:

1. **Run games in parallel.** The arena is serial today. The engine is pure and
   deterministic given a seed, so games are embarrassingly parallel across
   worker threads or separate node processes. On an 8-core machine this is close
   to an 8x saving in wall time for no statistical cost. Do this one first.
2. **Paired comparisons (common random numbers).** Play the *same* deal seed
   several times with the agents rotated through the seats, so deal luck cancels
   between agents instead of being averaged away. In a high-luck game this is a
   large variance reduction per game played. The arena already rotates seats,
   but across different seeds rather than within one.
3. **Spend the budget where it is informative.** Most of the wall clock goes on
   Sage at 2000ms per decision. Games that do not include the tiers under
   question are comparatively cheap.

### Open question

Re-measuring moves the anchors, which is the same open question already listed
under "Rate the human player". Decide the two together.

---

## A stronger opponent above Sage

**Status:** wanted, not started. Raised 2026-08-29.

**What:** a new roster tier that is genuinely stronger than Sage, not merely
given more time.

### Do not just raise the search budget

The measurement already rules this out. Going from Vin at 40ms to Sage at
2000ms - a fiftyfold increase in thinking time - bought under 90 Elo, and the
top four tiers are not statistically separable at all. That is direct evidence
the search is limited by **evaluation quality, not by iteration count**. Adding
a "Sage at 8000ms" tier would cost eight times the wall clock and land inside
the existing error bars.

### Where the strength actually is, best first

1. **A better evaluation function.** `expectedScore` / `evaluateGrid` drives
   both the rollout policy and the action priors, so it bounds what the search
   can do. This is the bottleneck and the highest-leverage change.
2. **Inference from opponent behaviour.** Determinization currently samples the
   unseen cards uniformly. It ignores what opponents' choices reveal: someone
   who takes a 9 off a discard pile probably has a use for a 9. Weighting the
   sampling by that inference is the classic next step for an ISMCTS agent and
   fits the existing `determinize` seam cleanly.
3. **Re-tune the search hyperparameters.** `explorationC`, `priorWeight` and
   especially `rolloutTurnLimit` were tuned at low budgets; the right values at
   a large budget may differ. Cheap to sweep once the arena runs in parallel.

### Note

Any new tier needs a fresh ladder run to rate it, so schedule this with the
error-bar work rather than separately.
