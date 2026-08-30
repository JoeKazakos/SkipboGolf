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

**Status:** attempted 2026-08-30, **not achieved**. **Priority: medium.**

**What:** a roster tier genuinely stronger than Sage.

### What was tried, and the result

Raising the search budget was ruled out by measurement and still is: Ada at
150ms to Sage at 2000ms buys about 100 Elo, and the top three tiers sit within
a standard error or two of each other.

So the attempt went at the evaluation instead, which is what the measurements
point to as the real bound. The clearest gap in `evaluateGrid` is that it only
ever sees your own grid: it plays identically whether the round has fifty turns
left or one, even though a tidy hand you never finish is worth nothing.
`raceFaceUpWeight` scales the value of turning cards face up by how close the
nearest opponent is to going out, quadratically so late pressure bites hardest.

**It did not work.** Over 560 games the race-aware agent, at Sage's own 2000ms
budget, rated 1655 +/-36 against Sage's 1684 +/-29, with a worse mean score
(2.91 against 2.31, about one standard error) and a worse win rate (26.5%
against 30.8%). Not significantly worse - but certainly not better.

The mechanism survives in the code, off by default and covered by tests
(`raceaware.test.ts`), including one proving the flag actually changes
decisions. Turning it on is a one-line change to a profile.

### Why it may have failed, and what to try next

Worth thinking about before spending another run:

- **The rollout policy already ends rounds.** ISMCTS rollouts play to a
  terminal state or a turn limit, so the search may already see the value of
  going out through the rollout result. Adding a heuristic term for it could be
  double-counting something the search knows better.
- **The term is crude.** It scales one weight by the leader's face-up count.
  It does not consider whether YOU are close to going out, nor whether racing
  is even winnable from your position - sometimes the right answer to an
  opponent about to go out is to salvage your score, not to sprint.
- **Better next levers**, in order:
  1. **Inference from opponent behaviour.** Determinization samples the unseen
     cards uniformly and ignores what opponents' choices reveal: someone taking
     a 9 off a discard pile probably has a use for a 9. This is the standard
     next step for an ISMCTS agent and fits the `determinize` seam cleanly. It
     is now cheap to evaluate, since the arena runs 560 games in 30 minutes.
  2. **Re-tune the search hyperparameters.** `explorationC`, `priorWeight` and
     `rolloutTurnLimit` were set at low budgets and never revisited at high
     ones. A parameter sweep is now affordable.
  3. **A better column model.** `expectedColumnScore` uses fixed constants for
     the chance a hidden card cancels; these could be derived from the actual
     unseen multiset the agent already tracks.

### A methodological lesson worth keeping

The same runs flipped the Vin/Nel ordering: 480 games put Nel ahead by 14 Elo
with mean scores agreeing at 1.8 standard errors, and 560 games put Vin ahead
by 37. Both sat inside their error bars. A ~1.8 standard error signal in this
game is not a result. Require a gap to survive two independent runs before
acting on it.

---










