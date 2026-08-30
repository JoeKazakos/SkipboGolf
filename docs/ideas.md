# Ideas and backlog

Things worth building, parked deliberately rather than forgotten. Each entry
records enough context to pick it up cold: what it is, why it is wanted, what
was already worked out, and what is still open.

Delete an entry when it ships or when it is decided against.

## At a glance

| Priority | Item |
| -------- | ---- |
| Medium | A stronger opponent above Sage |
| Low | Tighten the error bars on the CPU ratings |

Keep this table in step with the Status lines below when priorities change.

Settings live in one place: `src/ui/settings.tsx`, opened from the top bar.
Add new preferences there rather than to the top bar.

---


## Tighten the error bars on the CPU ratings

**Status:** wanted, not started. **Priority: low.** Raised 2026-08-29. Pairs
with "Rate the human player": that feature fits the player against these
ratings as fixed anchors, so the anchors want to be firm first. Note the
priority mismatch - the dependent feature is medium while this is low, so
either accept looser anchors for a first version of it, or promote this when
that work starts.

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

**Status:** wanted, not started. **Priority: medium.** Raised 2026-08-29.

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

---










