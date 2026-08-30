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










